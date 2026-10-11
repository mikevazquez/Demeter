alter table public.product_acquisitions add column refund_access_blocked boolean not null default false;
create or replace function public.sale_collectible_total(p_sale_id uuid)
returns integer language sql stable security invoker set search_path='' as $$
 select coalesce(sum(greatest(sl.line_total_minor-coalesce((select sum(p.amount_minor) from public.payments p where p.sale_line_id=sl.id and p.kind='refund'),0),0)),0)::integer from public.sale_lines sl where sl.sale_id=p_sale_id and sl.refunded_at is null;
$$;
revoke all on function public.sale_collectible_total(uuid) from public,anon;
grant execute on function public.sale_collectible_total(uuid) to authenticated,service_role;
create or replace view public.v_sale_balances with (security_invoker=true) as
 select s.id as sale_id,s.studio_id,s.student_id,s.status,s.total_minor,
 case when s.status='voided' then 0 else public.sale_collectible_total(s.id) end as collectible_minor,
 coalesce((select sum(case when p.kind='refund' then -p.amount_minor else p.amount_minor end) from public.payments p where p.sale_id=s.id),0)::integer as net_paid_minor,
 case when s.status='voided' then 0 else greatest(public.sale_collectible_total(s.id)-coalesce((select sum(case when p.kind='refund' then -p.amount_minor else p.amount_minor end) from public.payments p where p.sale_id=s.id),0),0)::integer end as balance_minor
 from public.sales s;
grant select on public.v_sale_balances to authenticated;
CREATE OR REPLACE FUNCTION public.admin_refund_sale_line(target_sale_line_id uuid, refund_amount_minor integer, refund_method text, refund_reason text, refund_reference text DEFAULT NULL::text, refund_notes text DEFAULT NULL::text, p_block_package boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select * into v_acquisition from public.product_acquisitions where sale_line_id=v_line.id for update;
  if not found then
    select * into v_enrollment from public.student_enrollments where source_sale_line_id=v_line.id for update;
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

  if refund_amount_minor > (v_line.line_total_minor - v_line_refunded) then raise exception 'refund_exceeds_line'; end if;

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

  if coalesce(p_block_package,false) then
    if v_acquisition.id is null then raise exception 'refund_block_package_only';end if;
    update public.product_acquisitions set access_blocked=true,refund_access_blocked=true,updated_at=now() where id=v_acquisition.id;
  end if;

  v_total_refunded := v_total_refunded + refund_amount_minor;
  v_net_collected := v_gross_paid - v_total_refunded;

  select public.sale_collectible_total(v_sale.id) into v_collectible_total;

  v_balance := greatest(v_collectible_total - v_net_collected,0);

  return jsonb_build_object(
    'ok',true,'sale_id',v_sale.id,'sale_line_id',v_line.id,
    'acquisition_id',v_acquisition.id,'enrollment_id',v_enrollment.id,
    'gross_paid_minor',v_gross_paid,'refunded_minor',v_total_refunded,
    'net_collected_minor',v_net_collected,'collectible_total_minor',v_collectible_total,
    'balance_minor',v_balance
  );
end;
$function$;

revoke all on function public.admin_refund_sale_line(uuid,integer,text,text,text,text,boolean) from public,anon;
grant execute on function public.admin_refund_sale_line(uuid,integer,text,text,text,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_register_sale_payment(target_sale_id uuid, payment_amount_minor integer, payment_method text, payment_reference text DEFAULT NULL::text, payment_notes text DEFAULT NULL::text, p_effective_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale public.sales%rowtype;
  v_today date; v_effective_on date;
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
  select (now() at time zone coalesce(timezone,'America/Mexico_City'))::date into v_today from public.studios where id=v_sale.studio_id;
  v_effective_on:=coalesce(p_effective_on,v_today);
  if v_effective_on<v_today-7 or v_effective_on>v_today then raise exception 'payment_date_invalid';end if;
  if v_sale.status<>'confirmed' then raise exception 'sale_not_open'; end if;

  select coalesce(sum(case when p.kind='payment' then p.amount_minor else 0 end),0)::integer,
    coalesce(sum(case when p.kind='refund' then p.amount_minor else 0 end),0)::integer
  into v_gross_paid,v_total_refunded from public.payments p where p.sale_id=v_sale.id;

  v_net_collected:=v_gross_paid-v_total_refunded;
  select public.sale_collectible_total(v_sale.id) into v_collectible_total;

  v_balance:=greatest(v_collectible_total-v_net_collected,0);
  if v_balance<=0 then raise exception 'sale_already_paid'; end if;
  if payment_amount_minor>v_balance then raise exception 'payment_exceeds_balance'; end if;

  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,effective_on,created_by)
  values(v_sale.studio_id,v_sale.id,'payment',payment_amount_minor,trim(payment_method),
    nullif(trim(coalesce(payment_reference,'')),''),nullif(trim(coalesce(payment_notes,'')),''),
    v_effective_on,(select auth.uid()));

  v_gross_paid:=v_gross_paid+payment_amount_minor;
  v_net_collected:=v_gross_paid-v_total_refunded;
  v_balance:=greatest(v_collectible_total-v_net_collected,0);

  if v_balance=0 then
    update public.product_acquisitions pa
    set access_blocked=false,updated_at=now()
    from public.sale_lines sl
    where sl.sale_id=v_sale.id and pa.sale_line_id=sl.id and pa.status='active' and pa.refunded_at is null and not pa.refund_access_blocked;

    update public.sales set payment_due_on=null,collection_note=null,updated_at=now() where id=v_sale.id;
  end if;

  return jsonb_build_object('ok',true,'sale_id',v_sale.id,'total_minor',v_sale.total_minor,
    'gross_paid_minor',v_gross_paid,'refunded_minor',v_total_refunded,
    'net_collected_minor',v_net_collected,'collectible_total_minor',v_collectible_total,'balance_minor',v_balance);
end;
$function$
;
create or replace function public.register_sale_payment(target_sale_id uuid,payment_amount_minor integer,payment_method text,payment_reference text default null,payment_notes text default null) returns jsonb language sql set search_path='' as $$ select public.admin_register_sale_payment(target_sale_id,payment_amount_minor,payment_method,payment_reference,payment_notes,null); $$;
revoke all on function public.admin_register_sale_payment(uuid,integer,text,text,text,date) from public,anon;
grant execute on function public.admin_register_sale_payment(uuid,integer,text,text,text,date) to authenticated;

