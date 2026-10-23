-- Workshop purchases intentionally have no ordinary credit product/sale_line.
-- Use the existing sale/payment engine, with an explicit workshop-only collectible total.
-- Preserve the existing generic sale-line calculation; workshop handling is scoped
-- to the authenticated payment engine below, after its sale/capability checks.
create or replace function public.sale_collectible_total(p_sale_id uuid)
returns integer language sql stable set search_path='' as $$
 select coalesce(sum(greatest(sl.line_total_minor-coalesce((select sum(p.amount_minor) from public.payments p where p.sale_line_id=sl.id and p.kind='refund'),0),0)),0)::integer from public.sale_lines sl where sl.sale_id=p_sale_id and sl.refunded_at is null
$$;

create function public.admin_workshop_reservation_balances(p_studio_id uuid,p_reservation_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'students.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'sales.read'),false)
 or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active') then raise exception 'forbidden'; end if;
 if p_reservation_ids is null or cardinality(p_reservation_ids)>5000 then raise exception 'invalid_selection'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('reservationId',r.id,'purchaseId',p.id,'saleId',p.sale_id,
  'title',o.title,'balanceMinor',greatest(0,p.total_minor-coalesce((select sum(case when py.kind='refund' then -py.amount_minor else py.amount_minor end) from public.payments py where py.studio_id=p_studio_id and py.sale_id=p.sale_id),0)))), '[]'::jsonb) into result
 from public.workshop_purchase_sessions ps join public.workshop_purchases p on p.id=ps.purchase_id and p.studio_id=p_studio_id
 join public.workshop_offers o on o.id=p.offer_id and o.studio_id=p_studio_id
 join public.reservations r on r.id=ps.reservation_id and r.studio_id=p_studio_id and r.student_id=p.student_id
 join public.sales s on s.id=p.sale_id and s.studio_id=p_studio_id and s.student_id=p.student_id and s.status='confirmed'
 where r.id=any(p_reservation_ids);
 return result;
end $$;
revoke all on function public.admin_workshop_reservation_balances(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_workshop_reservation_balances(uuid,uuid[]) to authenticated;

create function public.admin_register_workshop_installment(
 p_studio_id uuid,p_sale_id uuid,p_reservation_id uuid,p_session_id uuid,
 p_amount_minor integer,p_method text,p_reference text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare sale public.sales%rowtype; purchase public.workshop_purchases%rowtype; old public.payments%rowtype; result jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'students.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.read'),false)
 or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active') then raise exception 'forbidden'; end if;
 if p_amount_minor is null or p_amount_minor<=0 or p_reference is null or length(btrim(p_reference)) not between 3 and 200
  or p_method is null or p_method not in ('cash','bank_transfer') then raise exception 'payment_invalid'; end if;
 if not exists(select 1 from public.studio_payment_methods where studio_id=p_studio_id and code=p_method and active) then raise exception 'payment_method_unavailable'; end if;
 -- Same sale lock used by the existing payment engine, then the purchase snapshot.
 select * into sale from public.sales where id=p_sale_id and studio_id=p_studio_id and status='confirmed' for update;
 if not found then raise exception 'sale_not_found'; end if;
 select * into purchase from public.workshop_purchases where sale_id=sale.id and studio_id=p_studio_id and student_id=sale.student_id for update;
 if not found or not exists(select 1 from public.workshop_purchase_sessions ps join public.reservations r on r.id=ps.reservation_id
  where ps.purchase_id=purchase.id and ps.reservation_id=p_reservation_id and ps.session_id=p_session_id
   and r.studio_id=p_studio_id and r.student_id=purchase.student_id) then raise exception 'workshop_payment_not_linked'; end if;
 select * into old from public.payments where studio_id=p_studio_id and sale_id=sale.id and kind='payment' and reference=btrim(p_reference) order by id limit 1;
 if found then
  if old.amount_minor<>p_amount_minor or old.method<>p_method then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'sale_id',sale.id,'replayed',true,'balance_minor',greatest(0,purchase.total_minor-purchase.paid_minor));
 end if;
 result:=public.register_sale_payment(sale.id,p_amount_minor,p_method,btrim(p_reference),'Abono de taller desde Hoy');
 if coalesce((result->>'ok')::boolean,false) is distinct from true then raise exception 'workshop_payment_failed'; end if;
 return result||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.admin_register_workshop_installment(uuid,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_register_workshop_installment(uuid,uuid,uuid,uuid,integer,text,text) to authenticated;

-- Preserve and version the existing Sandbox payment engine (2026-10-19).
-- Its collectible-total branch additionally recognizes owned workshop purchases; ordinary sale lines retain their calculation.
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
  if exists(select 1 from public.workshop_purchases where sale_id=v_sale.id
    and studio_id=v_sale.studio_id and student_id=v_sale.student_id) then
    select total_minor into v_collectible_total from public.workshop_purchases
     where sale_id=v_sale.id and studio_id=v_sale.studio_id and student_id=v_sale.student_id;
  else
    select public.sale_collectible_total(v_sale.id) into v_collectible_total;
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.register_sale_payment(target_sale_id uuid, payment_amount_minor integer, payment_method text, payment_reference text DEFAULT NULL::text, payment_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select public.admin_register_sale_payment(target_sale_id,payment_amount_minor,payment_method,payment_reference,payment_notes,null); $function$;
revoke all on function public.admin_register_sale_payment(uuid,integer,text,text,text,date),public.register_sale_payment(uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_register_sale_payment(uuid,integer,text,text,text,date),public.register_sale_payment(uuid,integer,text,text,text) to authenticated,service_role;

revoke all on function public.sale_collectible_total(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sale_collectible_total(uuid) to authenticated,service_role;

-- Trigger-only function; clients never invoke it as a Data API RPC.
revoke all on function public.sync_workshop_paid_from_sale_payment() from public,anon,authenticated,service_role;
