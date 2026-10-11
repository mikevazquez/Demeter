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
  select coalesce(sum(sl.line_total_minor),0)::integer into v_collectible_total
  from public.sale_lines sl where sl.sale_id=v_sale.id and sl.refunded_at is null;

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
    where sl.sale_id=v_sale.id and pa.sale_line_id=sl.id and pa.status='active' and pa.refunded_at is null;

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

