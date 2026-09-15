do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid='public.product_templates'::regclass
      and conname='product_templates_check'
  ) then
    alter table public.product_templates drop constraint product_templates_check;
  end if;
end $$;

alter table public.product_templates
  add constraint product_templates_check check (
    (product_type='enrollment' and not unlimited and credit_limit is null)
    or
    (product_type<>'enrollment' and (
      (unlimited and credit_limit is null)
      or
      (not unlimited and credit_limit is not null)
    ))
  );

alter table public.sale_lines
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text,
  add column if not exists refunded_by uuid references auth.users(id) on delete set null;

update public.sale_lines sl
set refunded_at=pa.refunded_at,
    refund_reason=coalesce(sl.refund_reason,pa.refund_reason),
    refunded_by=coalesce(sl.refunded_by,pa.refunded_by)
from public.product_acquisitions pa
where pa.sale_line_id=sl.id
  and pa.refunded_at is not null
  and sl.refunded_at is null;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname='enrollment_status'
      and typnamespace='public'::regnamespace
  ) then
    create type public.enrollment_status as enum ('active','expired','cancelled','refunded');
  end if;
end $$;

create table if not exists public.enrollment_policies (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  enabled boolean not null default false,
  required_for_booking boolean not null default false,
  enrollment_product_template_id uuid references public.product_templates(id) on delete set null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enrollment_policies_rules_object check (jsonb_typeof(rules)='object')
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status public.enrollment_status not null default 'active',
  starts_on date not null,
  expires_on date,
  source_sale_id uuid references public.sales(id) on delete restrict,
  source_sale_line_id uuid unique references public.sale_lines(id) on delete restrict,
  refunded_at timestamptz,
  refund_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_enrollments_date_order check (expires_on is null or expires_on >= starts_on)
);

create index if not exists student_enrollments_student_idx
  on public.student_enrollments(studio_id,student_id,starts_on desc);
create index if not exists student_enrollments_current_idx
  on public.student_enrollments(studio_id,student_id,status,expires_on);

alter table public.enrollment_policies enable row level security;
alter table public.student_enrollments enable row level security;

drop policy if exists enrollment_policies_read on public.enrollment_policies;
create policy enrollment_policies_read on public.enrollment_policies
for select to authenticated
using (
  private.has_capability(studio_id,'sales.read')
  or private.has_capability(studio_id,'settings.write')
);

drop policy if exists student_enrollments_read on public.student_enrollments;
create policy student_enrollments_read on public.student_enrollments
for select to authenticated
using (
  private.has_capability(studio_id,'students.read')
  or private.has_capability(studio_id,'sales.read')
  or exists (
    select 1 from public.students s
    where s.id=student_id
      and s.user_id=(select auth.uid())
      and private.has_capability(studio_id,'student.profile.self')
  )
);

revoke all on public.enrollment_policies from anon;
revoke all on public.student_enrollments from anon;
revoke insert,update,delete,truncate,references,trigger on public.enrollment_policies from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.student_enrollments from authenticated;
grant select on public.enrollment_policies to authenticated;
grant select on public.student_enrollments to authenticated;

create or replace function public.set_enrollment_policy(
  target_studio_id uuid,
  target_enabled boolean,
  target_required_for_booking boolean,
  target_product_template_id uuid,
  target_rules jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_product public.product_templates%rowtype;
  v_rules jsonb := coalesce(target_rules,'{}'::jsonb);
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if not private.has_capability(target_studio_id,'settings.write') then raise exception 'forbidden'; end if;
  if jsonb_typeof(v_rules) <> 'object' then raise exception 'enrollment_rules_invalid'; end if;

  if target_enabled then
    if target_product_template_id is null then raise exception 'enrollment_product_required'; end if;
    select * into v_product
    from public.product_templates
    where id=target_product_template_id
      and studio_id=target_studio_id
      and active=true;
    if not found then raise exception 'enrollment_product_not_found'; end if;
    if v_product.product_type <> 'enrollment' then raise exception 'enrollment_product_type_required'; end if;
  elsif target_product_template_id is not null then
    select * into v_product
    from public.product_templates
    where id=target_product_template_id and studio_id=target_studio_id;
    if not found then raise exception 'enrollment_product_not_found'; end if;
    if v_product.product_type <> 'enrollment' then raise exception 'enrollment_product_type_required'; end if;
  end if;

  insert into public.enrollment_policies(
    studio_id,enabled,required_for_booking,enrollment_product_template_id,rules,updated_at
  ) values(
    target_studio_id,target_enabled,target_required_for_booking,target_product_template_id,v_rules,now()
  )
  on conflict (studio_id) do update
  set enabled=excluded.enabled,
      required_for_booking=excluded.required_for_booking,
      enrollment_product_template_id=excluded.enrollment_product_template_id,
      rules=excluded.rules,
      updated_at=now();

  return jsonb_build_object(
    'ok',true,
    'studio_id',target_studio_id,
    'enabled',target_enabled,
    'required_for_booking',target_required_for_booking,
    'product_template_id',target_product_template_id
  );
end;
$$;

create or replace function public.create_manual_sale(
  target_student_id uuid,
  target_product_ids uuid[],
  initial_payment_minor integer default 0,
  payment_method text default null,
  payment_reference text default null,
  payment_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_has_policy boolean := false;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_acquisition_id uuid;
  v_enrollment_id uuid;
  v_studio_timezone text;
  v_start_date date;
  v_folio text;
  v_total integer := 0;
  v_currency text := null;
  v_product_id uuid;
  v_distinct_count integer;
  v_paid integer := greatest(coalesce(initial_payment_minor,0),0);
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_product_ids is null or cardinality(target_product_ids)=0 then raise exception 'products_required'; end if;
  if coalesce(initial_payment_minor,0) < 0 then raise exception 'payment_invalid'; end if;

  select * into v_student from public.students where id=target_student_id for update;
  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status <> 'active' then raise exception 'student_not_operable'; end if;
  if not private.has_capability(v_student.studio_id,'sales.write') then raise exception 'forbidden'; end if;

  select * into v_policy
  from public.enrollment_policies
  where studio_id=v_student.studio_id;
  v_has_policy := found;

  select count(distinct x), count(*) into v_distinct_count, v_total
  from unnest(target_product_ids) as x;
  if v_distinct_count <> v_total then raise exception 'duplicate_product_line'; end if;
  v_total := 0;

  foreach v_product_id in array target_product_ids loop
    select * into v_product from public.product_templates
    where id=v_product_id and studio_id=v_student.studio_id and active=true;
    if not found then raise exception 'product_not_available'; end if;
    if v_product.product_type='enrollment' and (
      not v_has_policy
      or not v_policy.enabled
      or v_policy.enrollment_product_template_id is distinct from v_product.id
    ) then
      raise exception 'enrollment_product_not_configured';
    end if;
    if v_currency is null then v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then raise exception 'currency_mismatch'; end if;
    v_total := v_total + v_product.price_minor;
  end loop;

  if v_paid > v_total then raise exception 'payment_exceeds_balance'; end if;
  if v_paid > 0 and nullif(trim(coalesce(payment_method,'')),'') is null then raise exception 'payment_method_required'; end if;

  select timezone into v_studio_timezone from public.studios where id=v_student.studio_id;
  v_start_date := (now() at time zone coalesce(v_studio_timezone,'America/Mexico_City'))::date;
  v_folio := 'V-' || to_char(v_start_date,'YYYYMMDD') || '-' || upper(substr(replace(v_sale_id::text,'-',''),1,12));

  insert into public.sales(id,studio_id,student_id,folio,currency,total_minor,created_by)
  values(v_sale_id,v_student.studio_id,v_student.id,v_folio,coalesce(v_currency,'MXN'),v_total,(select auth.uid()));

  foreach v_product_id in array target_product_ids loop
    v_acquisition_id := null;
    v_enrollment_id := null;
    select * into v_product from public.product_templates where id=v_product_id;

    insert into public.sale_lines(studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor)
    values(v_student.studio_id,v_sale_id,v_product.id,v_product.name,1,v_product.price_minor,v_product.price_minor)
    returning id into v_sale_line_id;

    if v_product.product_type='enrollment' then
      insert into public.student_enrollments(
        studio_id,student_id,status,starts_on,expires_on,source_sale_id,source_sale_line_id,created_by
      ) values(
        v_student.studio_id,v_student.id,'active',v_start_date,
        v_start_date + v_product.validity_days,
        v_sale_id,v_sale_line_id,(select auth.uid())
      )
      on conflict (source_sale_line_id) do nothing
      returning id into v_enrollment_id;
    else
      insert into public.product_acquisitions(
        studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited,sale_line_id
      ) values(
        v_student.studio_id,v_student.id,v_product.id,'active',v_start_date,
        v_start_date + v_product.validity_days,
        v_product.credit_limit,v_product.unlimited,v_sale_line_id
      )
      on conflict (sale_line_id) where sale_line_id is not null do nothing
      returning id into v_acquisition_id;

      if v_acquisition_id is null then
        select id into v_acquisition_id from public.product_acquisitions where sale_line_id=v_sale_line_id;
      end if;

      if not v_product.unlimited and coalesce(v_product.credit_limit,0) > 0 then
        if not exists(
          select 1 from public.credit_ledger
          where acquisition_id=v_acquisition_id and movement_type='grant'
        ) then
          insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note,created_by)
          values(v_student.studio_id,v_acquisition_id,'grant',v_product.credit_limit,'Venta '||v_folio,(select auth.uid()));
        end if;
      end if;
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by)
    values(v_student.studio_id,v_sale_id,'payment',v_paid,trim(payment_method),nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),(select auth.uid()));
  end if;

  return jsonb_build_object(
    'ok',true,'sale_id',v_sale_id,'folio',v_folio,'total_minor',v_total,
    'paid_minor',v_paid,'balance_minor',v_total-v_paid
  );
end;
$$;

create or replace function public.refund_sale_line(
  target_sale_line_id uuid,
  refund_amount_minor integer,
  refund_method text,
  refund_reason text,
  refund_reference text default null,
  refund_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_line public.sale_lines%rowtype;
  v_sale public.sales%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_enrollment public.student_enrollments%rowtype;
  v_line_refunded integer := 0;
  v_gross_paid integer := 0;
  v_total_refunded integer := 0;
  v_net_collected integer := 0;
  v_collectible_total integer := 0;
  v_balance integer := 0;
  v_reason text;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if coalesce(refund_amount_minor,0) <= 0 then raise exception 'refund_invalid'; end if;
  if nullif(trim(coalesce(refund_method,'')),'') is null then raise exception 'refund_method_required'; end if;
  if nullif(trim(coalesce(refund_reason,'')),'') is null then raise exception 'refund_reason_required'; end if;
  v_reason := trim(refund_reason);

  select * into v_line from public.sale_lines where id=target_sale_line_id for update;
  if not found then raise exception 'sale_line_not_found'; end if;

  select * into v_sale from public.sales where id=v_line.sale_id for update;
  if not found then raise exception 'sale_not_found'; end if;
  if not private.has_capability(v_sale.studio_id,'sales.write') then raise exception 'forbidden'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'sale_not_open'; end if;

  select * into v_acquisition
  from public.product_acquisitions
  where sale_line_id=v_line.id
  for update;
  if not found then
    select * into v_enrollment
    from public.student_enrollments
    where source_sale_line_id=v_line.id
    for update;
    if not found then raise exception 'sale_line_fulfillment_not_found'; end if;
  end if;

  if v_acquisition.id is not null and exists(
    select 1
    from public.reservations r
    join public.class_sessions cs on cs.id=r.session_id
    where r.acquisition_id=v_acquisition.id
      and r.status='reserved'
      and cs.status='scheduled'
      and cs.starts_at > now()
  ) then
    raise exception 'refund_future_reservations_exist';
  end if;

  select coalesce(sum(p.amount_minor),0)::integer
  into v_line_refunded
  from public.payments p
  where p.sale_line_id=v_line.id and p.kind='refund';

  if refund_amount_minor > (v_line.line_total_minor - v_line_refunded) then
    raise exception 'refund_exceeds_line';
  end if;

  select
    coalesce(sum(case when p.kind='payment' then p.amount_minor else 0 end),0)::integer,
    coalesce(sum(case when p.kind='refund' then p.amount_minor else 0 end),0)::integer
  into v_gross_paid,v_total_refunded
  from public.payments p
  where p.sale_id=v_sale.id;

  v_net_collected := v_gross_paid - v_total_refunded;
  if refund_amount_minor > v_net_collected then raise exception 'refund_exceeds_collected'; end if;

  insert into public.payments(
    studio_id,sale_id,sale_line_id,kind,amount_minor,method,reference,notes,reason,created_by
  ) values(
    v_sale.studio_id,v_sale.id,v_line.id,'refund',refund_amount_minor,trim(refund_method),
    nullif(trim(coalesce(refund_reference,'')),''),nullif(trim(coalesce(refund_notes,'')),''),
    v_reason,(select auth.uid())
  );

  update public.sale_lines sl
  set refunded_at=coalesce(sl.refunded_at,now()),
      refund_reason=coalesce(sl.refund_reason,v_reason),
      refunded_by=coalesce(sl.refunded_by,(select auth.uid()))
  where sl.id=v_line.id;

  if v_acquisition.id is not null then
    update public.product_acquisitions pa
    set status='cancelled',
        refunded_at=coalesce(pa.refunded_at,now()),
        refund_reason=coalesce(pa.refund_reason,v_reason),
        refunded_by=coalesce(pa.refunded_by,(select auth.uid())),
        updated_at=now()
    where pa.id=v_acquisition.id;
  else
    update public.student_enrollments se
    set status='refunded',
        refunded_at=coalesce(se.refunded_at,now()),
        refund_reason=coalesce(se.refund_reason,v_reason),
        updated_at=now()
    where se.id=v_enrollment.id;
  end if;

  v_total_refunded := v_total_refunded + refund_amount_minor;
  v_net_collected := v_gross_paid - v_total_refunded;

  select coalesce(sum(sl.line_total_minor),0)::integer
  into v_collectible_total
  from public.sale_lines sl
  where sl.sale_id=v_sale.id and sl.refunded_at is null;

  v_balance := greatest(v_collectible_total - v_net_collected,0);

  return jsonb_build_object(
    'ok',true,'sale_id',v_sale.id,'sale_line_id',v_line.id,
    'acquisition_id',v_acquisition.id,'enrollment_id',v_enrollment.id,
    'gross_paid_minor',v_gross_paid,'refunded_minor',v_total_refunded,
    'net_collected_minor',v_net_collected,'collectible_total_minor',v_collectible_total,
    'balance_minor',v_balance
  );
end;
$$;

create or replace function public.void_sale(
  target_sale_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_sale public.sales%rowtype;
  v_gross_paid integer := 0;
  v_total_refunded integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if nullif(trim(coalesce(target_reason,'')),'') is null then raise exception 'void_reason_required'; end if;

  select * into v_sale from public.sales where id=target_sale_id for update;
  if not found then raise exception 'sale_not_found'; end if;
  if not private.has_capability(v_sale.studio_id,'sales.write') then raise exception 'forbidden'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'sale_not_open'; end if;

  select
    coalesce(sum(case when p.kind='payment' then p.amount_minor else 0 end),0)::integer,
    coalesce(sum(case when p.kind='refund' then p.amount_minor else 0 end),0)::integer
  into v_gross_paid,v_total_refunded
  from public.payments p
  where p.sale_id=v_sale.id;

  if (v_gross_paid-v_total_refunded)>0 then raise exception 'sale_has_unreturned_funds'; end if;

  if exists(
    select 1
    from public.sale_lines sl
    join public.product_acquisitions pa on pa.sale_line_id=sl.id
    join public.reservations r on r.acquisition_id=pa.id
    join public.class_sessions cs on cs.id=r.session_id
    where sl.sale_id=v_sale.id
      and r.status='reserved'
      and cs.status='scheduled'
      and cs.starts_at>now()
  ) then
    raise exception 'void_future_reservations_exist';
  end if;

  update public.sales
  set status='voided',
      void_reason=trim(target_reason),
      voided_at=now(),
      voided_by=(select auth.uid()),
      updated_at=now()
  where id=v_sale.id;

  update public.product_acquisitions pa
  set status='cancelled',updated_at=now()
  from public.sale_lines sl
  where sl.sale_id=v_sale.id
    and pa.sale_line_id=sl.id
    and pa.refunded_at is null
    and pa.status='active';

  update public.student_enrollments se
  set status='cancelled',updated_at=now()
  where se.source_sale_id=v_sale.id and se.status='active';

  return jsonb_build_object('ok',true,'sale_id',v_sale.id,'status','voided');
end;
$$;

create or replace function public.register_sale_payment(
  target_sale_id uuid,
  payment_amount_minor integer,
  payment_method text,
  payment_reference text default null,
  payment_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_sale public.sales%rowtype;
  v_gross_paid integer := 0;
  v_total_refunded integer := 0;
  v_net_collected integer := 0;
  v_collectible_total integer := 0;
  v_balance integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if coalesce(payment_amount_minor,0)<=0 then raise exception 'payment_invalid'; end if;
  if nullif(trim(coalesce(payment_method,'')),'') is null then raise exception 'payment_method_required'; end if;

  select * into v_sale from public.sales where id=target_sale_id for update;
  if not found then raise exception 'sale_not_found'; end if;
  if not private.has_capability(v_sale.studio_id,'sales.write') then raise exception 'forbidden'; end if;
  if v_sale.status<>'confirmed' then raise exception 'sale_not_open'; end if;

  select
    coalesce(sum(case when p.kind='payment' then p.amount_minor else 0 end),0)::integer,
    coalesce(sum(case when p.kind='refund' then p.amount_minor else 0 end),0)::integer
  into v_gross_paid,v_total_refunded
  from public.payments p
  where p.sale_id=v_sale.id;

  v_net_collected:=v_gross_paid-v_total_refunded;

  select coalesce(sum(sl.line_total_minor),0)::integer
  into v_collectible_total
  from public.sale_lines sl
  where sl.sale_id=v_sale.id and sl.refunded_at is null;

  v_balance:=greatest(v_collectible_total-v_net_collected,0);
  if v_balance<=0 then raise exception 'sale_already_paid'; end if;
  if payment_amount_minor>v_balance then raise exception 'payment_exceeds_balance'; end if;

  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by)
  values(
    v_sale.studio_id,v_sale.id,'payment',payment_amount_minor,trim(payment_method),
    nullif(trim(coalesce(payment_reference,'')),''),
    nullif(trim(coalesce(payment_notes,'')),''),
    (select auth.uid())
  );

  v_gross_paid:=v_gross_paid+payment_amount_minor;
  v_net_collected:=v_gross_paid-v_total_refunded;
  v_balance:=greatest(v_collectible_total-v_net_collected,0);

  return jsonb_build_object(
    'ok',true,'sale_id',v_sale.id,'total_minor',v_sale.total_minor,
    'gross_paid_minor',v_gross_paid,'refunded_minor',v_total_refunded,
    'net_collected_minor',v_net_collected,'collectible_total_minor',v_collectible_total,
    'balance_minor',v_balance
  );
end;
$$;

revoke all on function public.set_enrollment_policy(uuid,boolean,boolean,uuid,jsonb) from public,anon;
grant execute on function public.set_enrollment_policy(uuid,boolean,boolean,uuid,jsonb) to authenticated;
revoke all on function public.create_manual_sale(uuid,uuid[],integer,text,text,text) from public,anon;
grant execute on function public.create_manual_sale(uuid,uuid[],integer,text,text,text) to authenticated;
revoke all on function public.refund_sale_line(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.refund_sale_line(uuid,integer,text,text,text,text) to authenticated;
revoke all on function public.void_sale(uuid,text) from public,anon;
grant execute on function public.void_sale(uuid,text) to authenticated;
revoke all on function public.register_sale_payment(uuid,integer,text,text,text) from public,anon;
grant execute on function public.register_sale_payment(uuid,integer,text,text,text) to authenticated;
