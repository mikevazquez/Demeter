alter table public.payments
  add column if not exists sale_line_id uuid references public.sale_lines(id) on delete restrict;

create index if not exists payments_sale_line_idx on public.payments(sale_line_id, created_at);

alter table public.product_acquisitions
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text,
  add column if not exists refunded_by uuid references auth.users(id) on delete set null;

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
set search_path = ''
as $$
declare
  v_line public.sale_lines%rowtype;
  v_sale public.sales%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_line_refunded integer := 0;
  v_gross_paid integer := 0;
  v_total_refunded integer := 0;
  v_net_collected integer := 0;
  v_collectible_total integer := 0;
  v_balance integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if coalesce(refund_amount_minor,0) <= 0 then raise exception 'refund_invalid'; end if;
  if nullif(trim(coalesce(refund_method,'')),'') is null then raise exception 'refund_method_required'; end if;
  if nullif(trim(coalesce(refund_reason,'')),'') is null then raise exception 'refund_reason_required'; end if;

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
  if not found then raise exception 'acquisition_not_found'; end if;

  if exists(
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
    trim(refund_reason),(select auth.uid())
  );

  update public.product_acquisitions
  set status='cancelled',
      refunded_at=coalesce(refunded_at,now()),
      refund_reason=coalesce(refund_reason,trim(refund_reason)),
      refunded_by=coalesce(refunded_by,(select auth.uid())),
      updated_at=now()
  where id=v_acquisition.id;

  v_total_refunded := v_total_refunded + refund_amount_minor;
  v_net_collected := v_gross_paid - v_total_refunded;

  select coalesce(sum(sl.line_total_minor),0)::integer
  into v_collectible_total
  from public.sale_lines sl
  join public.product_acquisitions pa on pa.sale_line_id=sl.id
  where sl.sale_id=v_sale.id and pa.refunded_at is null;

  v_balance := greatest(v_collectible_total - v_net_collected,0);

  return jsonb_build_object(
    'ok',true,
    'sale_id',v_sale.id,
    'sale_line_id',v_line.id,
    'acquisition_id',v_acquisition.id,
    'gross_paid_minor',v_gross_paid,
    'refunded_minor',v_total_refunded,
    'net_collected_minor',v_net_collected,
    'collectible_total_minor',v_collectible_total,
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
set search_path = ''
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

  if (v_gross_paid - v_total_refunded) > 0 then raise exception 'sale_has_unreturned_funds'; end if;

  if exists(
    select 1
    from public.sale_lines sl
    join public.product_acquisitions pa on pa.sale_line_id=sl.id
    join public.reservations r on r.acquisition_id=pa.id
    join public.class_sessions cs on cs.id=r.session_id
    where sl.sale_id=v_sale.id
      and r.status='reserved'
      and cs.status='scheduled'
      and cs.starts_at > now()
  ) then
    raise exception 'void_future_reservations_exist';
  end if;

  update public.sales
  set status='voided',void_reason=trim(target_reason),voided_at=now(),voided_by=(select auth.uid()),updated_at=now()
  where id=v_sale.id;

  update public.product_acquisitions pa
  set status='cancelled',updated_at=now()
  from public.sale_lines sl
  where sl.sale_id=v_sale.id
    and pa.sale_line_id=sl.id
    and pa.refunded_at is null
    and pa.status='active';

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
set search_path = ''
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
  if coalesce(payment_amount_minor,0) <= 0 then raise exception 'payment_invalid'; end if;
  if nullif(trim(coalesce(payment_method,'')),'') is null then raise exception 'payment_method_required'; end if;

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

  v_net_collected := v_gross_paid - v_total_refunded;

  select coalesce(sum(sl.line_total_minor),0)::integer
  into v_collectible_total
  from public.sale_lines sl
  join public.product_acquisitions pa on pa.sale_line_id=sl.id
  where sl.sale_id=v_sale.id and pa.refunded_at is null;

  v_balance := greatest(v_collectible_total - v_net_collected,0);
  if v_balance <= 0 then raise exception 'sale_already_paid'; end if;
  if payment_amount_minor > v_balance then raise exception 'payment_exceeds_balance'; end if;

  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,created_by)
  values(v_sale.studio_id,v_sale.id,'payment',payment_amount_minor,trim(payment_method),nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),(select auth.uid()));

  v_gross_paid := v_gross_paid + payment_amount_minor;
  v_net_collected := v_gross_paid - v_total_refunded;
  v_balance := greatest(v_collectible_total - v_net_collected,0);

  return jsonb_build_object(
    'ok',true,'sale_id',v_sale.id,'total_minor',v_sale.total_minor,
    'gross_paid_minor',v_gross_paid,'refunded_minor',v_total_refunded,
    'net_collected_minor',v_net_collected,'collectible_total_minor',v_collectible_total,
    'balance_minor',v_balance
  );
end;
$$;

revoke all on function public.refund_sale_line(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.refund_sale_line(uuid,integer,text,text,text,text) to authenticated;
revoke all on function public.void_sale(uuid,text) from public,anon;
grant execute on function public.void_sale(uuid,text) to authenticated;
