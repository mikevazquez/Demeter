do $$ begin
  create type public.sale_status as enum ('confirmed','voided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_kind as enum ('payment','refund');
exception when duplicate_object then null; end $$;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  folio text not null,
  status public.sale_status not null default 'confirmed',
  currency text not null default 'MXN',
  total_minor integer not null check (total_minor >= 0),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(studio_id, folio),
  check ((status = 'voided' and void_reason is not null and voided_at is not null) or status = 'confirmed')
);

create table if not exists public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_template_id uuid not null references public.product_templates(id) on delete restrict,
  product_name text not null,
  quantity integer not null default 1 check (quantity = 1),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  line_total_minor integer not null check (line_total_minor >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  kind public.payment_kind not null default 'payment',
  amount_minor integer not null check (amount_minor > 0),
  method text not null,
  reference text,
  notes text,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'refund' and reason is not null) or kind = 'payment')
);

alter table public.product_acquisitions
  add column if not exists sale_line_id uuid references public.sale_lines(id) on delete restrict;
create unique index if not exists product_acquisitions_sale_line_unique
  on public.product_acquisitions(sale_line_id) where sale_line_id is not null;

create index if not exists sales_studio_created_idx on public.sales(studio_id, created_at desc);
create index if not exists sales_student_idx on public.sales(student_id, created_at desc);
create index if not exists sale_lines_sale_idx on public.sale_lines(sale_id);
create index if not exists payments_sale_idx on public.payments(sale_id, created_at);

alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.payments enable row level security;

drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated
using ((select private.has_capability(studio_id, 'sales.read')));

drop policy if exists sale_lines_read on public.sale_lines;
create policy sale_lines_read on public.sale_lines for select to authenticated
using ((select private.has_capability(studio_id, 'sales.read')));

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
using ((select private.has_capability(studio_id, 'sales.read')));

grant select on public.sales, public.sale_lines, public.payments to authenticated;
revoke insert, update, delete on public.sales, public.sale_lines, public.payments from anon, authenticated;

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
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_acquisition_id uuid;
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

  select count(distinct x), count(*) into v_distinct_count, v_total
  from unnest(target_product_ids) as x;
  if v_distinct_count <> v_total then raise exception 'duplicate_product_line'; end if;
  v_total := 0;

  foreach v_product_id in array target_product_ids loop
    select * into v_product from public.product_templates
    where id=v_product_id and studio_id=v_student.studio_id and active=true;
    if not found then raise exception 'product_not_available'; end if;
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
    select * into v_product from public.product_templates where id=v_product_id;

    insert into public.sale_lines(studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor)
    values(v_student.studio_id,v_sale_id,v_product.id,v_product.name,1,v_product.price_minor,v_product.price_minor)
    returning id into v_sale_line_id;

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
      if not exists(select 1 from public.credit_ledger where acquisition_id=v_acquisition_id and movement_type='grant') then
        insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note,created_by)
        values(v_student.studio_id,v_acquisition_id,'grant',v_product.credit_limit,'Venta '||v_folio,(select auth.uid()));
      end if;
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by)
    values(v_student.studio_id,v_sale_id,'payment',v_paid,trim(payment_method),nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),(select auth.uid()));
  end if;

  return jsonb_build_object('ok',true,'sale_id',v_sale_id,'folio',v_folio,'total_minor',v_total,'paid_minor',v_paid,'balance_minor',v_total-v_paid);
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
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_paid integer;
  v_balance integer;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if coalesce(payment_amount_minor,0) <= 0 then raise exception 'payment_invalid'; end if;
  if nullif(trim(coalesce(payment_method,'')),'') is null then raise exception 'payment_method_required'; end if;

  select * into v_sale from public.sales where id=target_sale_id for update;
  if not found then raise exception 'sale_not_found'; end if;
  if not private.has_capability(v_sale.studio_id,'sales.write') then raise exception 'forbidden'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'sale_not_open'; end if;

  select coalesce(sum(case when kind='payment' then amount_minor else -amount_minor end),0)::integer
  into v_paid from public.payments where sale_id=v_sale.id;
  v_balance := v_sale.total_minor - v_paid;
  if v_balance <= 0 then raise exception 'sale_already_paid'; end if;
  if payment_amount_minor > v_balance then raise exception 'payment_exceeds_balance'; end if;

  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by)
  values(v_sale.studio_id,v_sale.id,'payment',payment_amount_minor,trim(payment_method),nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),(select auth.uid()));

  v_paid := v_paid + payment_amount_minor;
  return jsonb_build_object('ok',true,'sale_id',v_sale.id,'total_minor',v_sale.total_minor,'paid_minor',v_paid,'balance_minor',v_sale.total_minor-v_paid);
end;
$$;

revoke all on function public.create_manual_sale(uuid,uuid[],integer,text,text,text) from public,anon;
grant execute on function public.create_manual_sale(uuid,uuid[],integer,text,text,text) to authenticated;
revoke all on function public.register_sale_payment(uuid,integer,text,text,text) from public,anon;
grant execute on function public.register_sale_payment(uuid,integer,text,text,text) to authenticated;
