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
    v_reason,(select auth.uid())
  );

  update public.product_acquisitions pa
  set status='cancelled',
      refunded_at=coalesce(pa.refunded_at,now()),
      refund_reason=coalesce(pa.refund_reason,v_reason),
      refunded_by=coalesce(pa.refunded_by,(select auth.uid())),
      updated_at=now()
  where pa.id=v_acquisition.id;

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

revoke all on function public.refund_sale_line(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.refund_sale_line(uuid,integer,text,text,text,text) to authenticated;
