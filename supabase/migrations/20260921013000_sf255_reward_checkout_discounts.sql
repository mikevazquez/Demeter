-- SF-255B2 · Reward level discounts for eligible checkout products

alter table public.product_templates
  add column if not exists reward_discount_eligible boolean not null default false,
  add column if not exists reward_discount_family text;

alter table public.product_templates
  drop constraint if exists product_templates_reward_discount_family_check;

alter table public.product_templates
  add constraint product_templates_reward_discount_family_check
  check (
    reward_discount_family is null
    or reward_discount_family in ('private_class','workshop','masterclass','event')
  );

alter table public.online_checkout_attempts
  add column if not exists regular_amount_minor integer,
  add column if not exists reward_discount_minor integer not null default 0,
  add column if not exists reward_discount_pct integer not null default 0,
  add column if not exists reward_level_key_snapshot text,
  add column if not exists reward_level_title_snapshot text,
  add column if not exists reward_discount_family_snapshot text;

update public.online_checkout_attempts
set regular_amount_minor = coalesce(regular_amount_minor, amount_minor)
where regular_amount_minor is null;

alter table public.online_checkout_attempts
  alter column regular_amount_minor set not null;

alter table public.online_checkout_attempts
  drop constraint if exists online_checkout_reward_discount_pct_check;
alter table public.online_checkout_attempts
  add constraint online_checkout_reward_discount_pct_check
  check (reward_discount_pct between 0 and 100);

alter table public.online_checkout_attempts
  drop constraint if exists online_checkout_reward_discount_minor_check;
alter table public.online_checkout_attempts
  add constraint online_checkout_reward_discount_minor_check
  check (
    reward_discount_minor >= 0
    and regular_amount_minor >= amount_minor
    and reward_discount_minor = regular_amount_minor - amount_minor
  );

create or replace function private.reward_checkout_price(
  p_student_id uuid,
  p_product_template_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_level public.reward_status_level_definitions%rowtype;
  v_regular integer;
  v_pct integer := 0;
  v_final integer;
  v_discount integer;
begin
  if p_student_id is null or p_product_template_id is null or p_as_of is null then
    raise exception 'reward_price_arguments_required';
  end if;

  select * into v_student
  from public.students
  where id=p_student_id;

  if not found then
    raise exception 'student_not_found';
  end if;

  select * into v_product
  from public.product_templates
  where id=p_product_template_id
    and studio_id=v_student.studio_id;

  if not found then
    raise exception 'product_not_found';
  end if;

  perform private.reward_status_sync_student(v_student.id,p_as_of);

  select d.* into v_level
  from public.reward_status_memberships m
  join public.reward_status_level_definitions d
    on d.studio_id=m.studio_id
   and d.level_key=m.current_level_key
  where m.studio_id=v_student.studio_id
    and m.student_id=v_student.id;

  if not found then
    raise exception 'reward_status_not_found';
  end if;

  v_regular := v_product.price_minor;

  if v_product.reward_discount_eligible
     and v_product.reward_discount_family is not null then
    if v_product.reward_discount_family = 'private_class' then
      v_pct := coalesce(v_level.private_discount_pct,0);
    else
      v_pct := coalesce(v_level.event_discount_pct,0);
    end if;
  end if;

  v_pct := greatest(0,least(v_pct,100));
  v_final := greatest(
    1,
    round(v_regular::numeric * (100-v_pct)::numeric / 100)::integer
  );
  v_discount := v_regular-v_final;

  return jsonb_build_object(
    'product_template_id',v_product.id,
    'eligible',v_product.reward_discount_eligible and v_product.reward_discount_family is not null,
    'discount_family',v_product.reward_discount_family,
    'level_key',v_level.level_key,
    'level_title',v_level.title,
    'discount_pct',v_pct,
    'regular_amount_minor',v_regular,
    'discount_minor',v_discount,
    'final_amount_minor',v_final,
    'currency',upper(v_product.currency)
  );
end;
$$;

revoke all on function private.reward_checkout_price(uuid,uuid,date)
from public,anon,authenticated,service_role;

create or replace function public.student_reward_product_price(
  target_product_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  if not exists (
    select 1
    from public.product_templates pt
    where pt.id=target_product_template_id
      and pt.studio_id=v_student.studio_id
      and pt.active=true
  ) then
    raise exception 'product_not_found';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;

  return private.reward_checkout_price(
    v_student.id,
    target_product_template_id,
    v_today
  );
end;
$$;

revoke all on function public.student_reward_product_price(uuid)
from public,anon;
grant execute on function public.student_reward_product_price(uuid)
to authenticated;

create or replace function public.student_reward_single_class_price(
  target_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_timezone text;
  v_today date;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=v_student.studio_id
    and status='scheduled'
    and starts_at>now();

  if not found then
    raise exception 'session_not_bookable';
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id
    and studio_id=v_student.studio_id
    and active=true;

  if not found or coalesce(v_template.drop_in_price_minor,0)<=0 then
    raise exception 'single_class_price_missing';
  end if;

  select pt.* into v_product
  from public.product_templates pt
  join public.product_template_disciplines ptd
    on ptd.product_template_id=pt.id
   and ptd.studio_id=pt.studio_id
  where pt.studio_id=v_student.studio_id
    and pt.product_type='single_class'::public.product_type
    and pt.active=true
    and pt.online_purchasable=true
    and pt.price_minor=v_template.drop_in_price_minor
    and coalesce(pt.credit_limit,0)=1
    and coalesce(pt.validity_days,0)>0
    and ptd.discipline_id=v_template.discipline_id
  order by pt.created_at asc
  limit 1;

  if not found then
    raise exception 'single_class_product_not_available';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;

  return private.reward_checkout_price(
    v_student.id,
    v_product.id,
    v_today
  ) || jsonb_build_object('session_id',v_session.id);
end;
$$;

revoke all on function public.student_reward_single_class_price(uuid)
from public,anon;
grant execute on function public.student_reward_single_class_price(uuid)
to authenticated;

create or replace function public.student_create_online_checkout_attempt(
  target_product_template_id uuid,
  target_client_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_price jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_product_template_id is null then raise exception 'product_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select pt.* into v_product
  from public.product_templates pt
  where pt.id=target_product_template_id
    and pt.studio_id=v_student.studio_id
    and pt.active=true
    and pt.online_purchasable=true
    and pt.product_type::text in ('package','membership');

  if not found then raise exception 'product_not_available_online'; end if;
  if v_product.price_minor<=0 then raise exception 'online_price_invalid'; end if;
  if v_product.validity_days is null or v_product.validity_days<=0 then
    raise exception 'product_validity_missing';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  v_price := private.reward_checkout_price(v_student.id,v_product.id,v_today);

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,provider,client_request_key,
    external_reference,amount_minor,currency,product_name_snapshot,
    validity_days_snapshot,credit_limit_snapshot,unlimited_snapshot,
    package_term_snapshot,regular_amount_minor,reward_discount_minor,
    reward_discount_pct,reward_level_key_snapshot,reward_level_title_snapshot,
    reward_discount_family_snapshot
  ) values (
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,'mercado_pago',
    target_client_request_key,'STFLOW-MP-'||v_attempt_id::text,
    (v_price->>'final_amount_minor')::integer,upper(v_product.currency),
    v_product.name,v_product.validity_days,v_product.credit_limit,
    v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::integer,
    (v_price->>'discount_minor')::integer,
    (v_price->>'discount_pct')::integer,
    v_price->>'level_key',
    v_price->>'level_title',
    v_price->>'discount_family'
  )
  on conflict(student_id,client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id=v_student.id
      and client_request_key=target_client_request_key;

    if v_attempt.product_template_id<>v_product.id then
      raise exception 'request_key_reused_for_different_product';
    end if;
  end if;

  return jsonb_build_object(
    'id',v_attempt.id,
    'external_reference',v_attempt.external_reference,
    'product_template_id',v_attempt.product_template_id,
    'amount_minor',v_attempt.amount_minor,
    'regular_amount_minor',v_attempt.regular_amount_minor,
    'reward_discount_minor',v_attempt.reward_discount_minor,
    'reward_discount_pct',v_attempt.reward_discount_pct,
    'reward_level_key',v_attempt.reward_level_key_snapshot,
    'reward_level_title',v_attempt.reward_level_title_snapshot,
    'reward_discount_family',v_attempt.reward_discount_family_snapshot,
    'currency',v_attempt.currency,
    'status',v_attempt.status::text,
    'provider_order_id',v_attempt.provider_order_id,
    'checkout_url',v_attempt.checkout_url,
    'created_at',v_attempt.created_at
  );
end;
$$;

revoke all on function public.student_create_online_checkout_attempt(uuid,uuid)
from public,anon;
grant execute on function public.student_create_online_checkout_attempt(uuid,uuid)
to authenticated;

create or replace function public.student_create_single_class_checkout_attempt(
  target_session_id uuid,
  target_client_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_attempt public.online_checkout_attempts%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_timezone text;
  v_today date;
  v_price jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_session_id is null then raise exception 'session_required'; end if;
  if target_client_request_key is null then raise exception 'request_key_required'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and private.is_current_student(s.id,s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select cs.* into v_session
  from public.class_sessions cs
  where cs.id=target_session_id
    and cs.studio_id=v_student.studio_id
    and cs.status='scheduled'
    and cs.starts_at>now();

  if not found then raise exception 'session_not_bookable'; end if;

  if (
    select count(*)
    from public.reservations r
    where r.session_id=v_session.id
      and r.status in ('reserved','attended')
  ) >= v_session.capacity then
    raise exception 'session_full';
  end if;

  select ct.* into v_template
  from public.class_templates ct
  where ct.id=v_session.template_id
    and ct.studio_id=v_student.studio_id
    and ct.active=true;

  if not found then raise exception 'activity_not_available'; end if;
  if coalesce(v_template.drop_in_price_minor,0)<=0 then
    raise exception 'single_class_price_missing';
  end if;

  select pt.* into v_product
  from public.product_templates pt
  join public.product_template_disciplines ptd
    on ptd.product_template_id=pt.id
   and ptd.studio_id=pt.studio_id
  where pt.studio_id=v_student.studio_id
    and pt.product_type='single_class'::public.product_type
    and pt.active=true
    and pt.online_purchasable=true
    and pt.price_minor=v_template.drop_in_price_minor
    and coalesce(pt.credit_limit,0)=1
    and coalesce(pt.validity_days,0)>0
    and ptd.discipline_id=v_template.discipline_id
  order by pt.created_at asc
  limit 1;

  if not found then raise exception 'single_class_product_not_available'; end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id=v_student.studio_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;

  v_price := private.reward_checkout_price(v_student.id,v_product.id,v_today);

  insert into public.online_checkout_attempts(
    id,studio_id,student_id,product_template_id,session_id,provider,
    client_request_key,external_reference,amount_minor,currency,
    product_name_snapshot,validity_days_snapshot,credit_limit_snapshot,
    unlimited_snapshot,package_term_snapshot,regular_amount_minor,
    reward_discount_minor,reward_discount_pct,reward_level_key_snapshot,
    reward_level_title_snapshot,reward_discount_family_snapshot
  ) values (
    v_attempt_id,v_student.studio_id,v_student.id,v_product.id,v_session.id,
    'mercado_pago',target_client_request_key,'STFLOW-MP-'||v_attempt_id::text,
    (v_price->>'final_amount_minor')::integer,upper(v_product.currency),
    v_product.name,v_product.validity_days,v_product.credit_limit,
    v_product.unlimited,v_product.package_term,
    (v_price->>'regular_amount_minor')::integer,
    (v_price->>'discount_minor')::integer,
    (v_price->>'discount_pct')::integer,
    v_price->>'level_key',
    v_price->>'level_title',
    v_price->>'discount_family'
  )
  on conflict(student_id,client_request_key) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then
    select * into v_attempt
    from public.online_checkout_attempts
    where student_id=v_student.id
      and client_request_key=target_client_request_key;

    if v_attempt.product_template_id<>v_product.id
       or v_attempt.session_id is distinct from v_session.id then
      raise exception 'request_key_reused_for_different_purchase';
    end if;
  end if;

  return jsonb_build_object(
    'id',v_attempt.id,
    'external_reference',v_attempt.external_reference,
    'product_template_id',v_attempt.product_template_id,
    'session_id',v_attempt.session_id,
    'amount_minor',v_attempt.amount_minor,
    'regular_amount_minor',v_attempt.regular_amount_minor,
    'reward_discount_minor',v_attempt.reward_discount_minor,
    'reward_discount_pct',v_attempt.reward_discount_pct,
    'reward_level_key',v_attempt.reward_level_key_snapshot,
    'reward_level_title',v_attempt.reward_level_title_snapshot,
    'reward_discount_family',v_attempt.reward_discount_family_snapshot,
    'currency',v_attempt.currency,
    'status',v_attempt.status::text,
    'provider_order_id',v_attempt.provider_order_id,
    'checkout_url',v_attempt.checkout_url,
    'created_at',v_attempt.created_at
  );
end;
$$;

revoke all on function public.student_create_single_class_checkout_attempt(uuid,uuid)
from public,anon;
grant execute on function public.student_create_single_class_checkout_attempt(uuid,uuid)
to authenticated;
