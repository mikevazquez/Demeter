-- Separate Studio Flow hard booking rules from Demi's own booking behavior.
create table if not exists public.assistant_booking_behaviors (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  prospect_require_payment_before_booking boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.assistant_booking_behaviors enable row level security;
revoke all on public.assistant_booking_behaviors from public, anon;
grant select,insert,update on public.assistant_booking_behaviors to authenticated, service_role;

drop policy if exists assistant_booking_behaviors_admin on public.assistant_booking_behaviors;
create policy assistant_booking_behaviors_admin on public.assistant_booking_behaviors
  for all to authenticated
  using (private.has_capability(studio_id,'settings.write'))
  with check (private.has_capability(studio_id,'settings.write'));

insert into public.assistant_booking_behaviors(studio_id,prospect_require_payment_before_booking)
select s.id,false from public.studios s
on conflict(studio_id) do nothing;

create or replace function private.demi_requires_trial_prepay(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select
    coalesce((
      select p.require_payment_before_booking
      from public.trial_booking_policies p
      where p.studio_id=target_studio_id
    ),false)
    or
    coalesce((
      select b.prospect_require_payment_before_booking
      from public.assistant_booking_behaviors b
      where b.studio_id=target_studio_id
    ),false);
$function$;

revoke all on function private.demi_requires_trial_prepay(uuid) from public,anon,authenticated;
grant execute on function private.demi_requires_trial_prepay(uuid) to service_role;

create or replace function public.service_prepare_trial_transfer(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_resource_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_policy public.trial_booking_policies%rowtype;
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_bank public.studio_bank_transfer_settings%rowtype;
  v_product public.product_templates%rowtype;
  v_attended integer := 0;
  v_active integer := 0;
  v_occupied integer := 0;
  v_intent_id uuid;
  v_currency text;
begin
  if target_studio_id is null or target_conversation_id is null or target_student_id is null or target_session_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_policy from public.trial_booking_policies where studio_id=target_studio_id;
  if not found or not v_policy.enabled then
    return jsonb_build_object('ok',false,'reason_code','trial_booking_disabled');
  end if;
  if not private.demi_requires_trial_prepay(target_studio_id) then
    return jsonb_build_object('ok',false,'reason_code','trial_prepay_not_enabled');
  end if;
  if v_policy.trial_payment_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','trial_payment_product_missing');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id and studio_id=target_studio_id
    and active=true and lifecycle_status='active'
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_operable'); end if;
  if v_student.student_type <> 'trial' then
    return jsonb_build_object('ok',false,'reason_code','trial_identity_required');
  end if;

  if not exists(
    select 1 from public.assistant_conversations c
    where c.id=target_conversation_id and c.studio_id=target_studio_id and c.student_id=target_student_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  select count(*)::integer into v_attended
  from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='attended';
  if v_attended>0 then
    return jsonb_build_object('ok',false,'reason_code','trial_completed_enrollment_required');
  end if;

  select count(*)::integer into v_active
  from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='reserved';
  if v_active>=v_policy.max_active_trial_reservations then
    return jsonb_build_object('ok',false,'reason_code','trial_active_booking_exists');
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id and studio_id=target_studio_id
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=clock_timestamp() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;

  select count(*)::integer into v_occupied
  from public.reservations
  where session_id=target_session_id and status in ('reserved','attended');
  if v_occupied>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if coalesce(v_session.requires_resource,false) then
    if target_resource_id is null then
      return jsonb_build_object('ok',false,'reason_code','resource_selection_required');
    end if;
    if not exists(
      select 1
      from public.session_resources sr
      join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
      where sr.studio_id=target_studio_id
        and sr.session_id=target_session_id
        and sr.resource_id=target_resource_id
        and sr.enabled=true and r.active=true
    ) then
      return jsonb_build_object('ok',false,'reason_code','resource_not_available');
    end if;
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id and studio_id=target_studio_id and active=true;
  if not found or coalesce(15000,0)<=0 then
    return jsonb_build_object('ok',false,'reason_code','trial_price_unavailable');
  end if;

  select * into v_product
  from public.product_templates
  where id=v_policy.trial_payment_product_template_id and studio_id=target_studio_id;
  if not found then return jsonb_build_object('ok',false,'reason_code','trial_payment_product_missing'); end if;

  if not exists(
    select 1 from public.studio_payment_methods spm
    where spm.studio_id=target_studio_id and spm.active=true
      and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank
  from public.studio_bank_transfer_settings
  where studio_id=target_studio_id and enabled=true;
  if not found
     or nullif(trim(coalesce(v_bank.bank_name,'')),'') is null
     or nullif(trim(coalesce(v_bank.account_holder,'')),'') is null
     or (
       nullif(trim(coalesce(v_bank.clabe,'')),'') is null
       and nullif(trim(coalesce(v_bank.account_number,'')),'') is null
       and nullif(trim(coalesce(v_bank.card_number,'')),'') is null
     ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_details_not_configured');
  end if;

  select upper(coalesce(currency,'MXN')) into v_currency from public.studios where id=target_studio_id;

  update public.assistant_transfer_purchase_intents
  set status='cancelled',updated_at=clock_timestamp()
  where studio_id=target_studio_id and conversation_id=target_conversation_id
    and intent_kind='trial_class' and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,session_id,product_template_id,
    amount_minor,currency,status,intent_kind,resource_id
  )
  values(
    target_studio_id,target_conversation_id,target_student_id,target_session_id,
    v_product.id,15000,v_currency,'awaiting_receipt',
    'trial_class',case when v_session.requires_resource then target_resource_id else null end
  )
  returning id into v_intent_id;

  return jsonb_build_object(
    'ok',true,'status','awaiting_receipt','intent_id',v_intent_id,
    'amount_minor',15000,'currency',v_currency,
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,'instructions',v_bank.instructions
    ),
    'receipt_required',true,'reservation_confirmed',false,
    'activation_rule','confirm_trial_on_matching_receipt'
  );
end;
$function$;
