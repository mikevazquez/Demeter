-- Reuse the existing service-scoped eligibility API. Keep the cash operation
-- invoker-scoped and preserve its ACLs; the private helper remains inaccessible.
CREATE OR REPLACE FUNCTION public.service_create_demi_cash_purchase(p_studio uuid, p_conversation uuid, p_student uuid, p_product uuid, p_key uuid, p_expected_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  st public.students%rowtype;
  pt public.product_templates%rowtype;
  old public.demi_cash_purchases%rowtype;
  sale uuid:=gen_random_uuid();
  line uuid;
  acquisition uuid;
  today date;
  eligibility jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;

  select * into st
  from public.students
  where id=p_student and studio_id=p_studio and active and lifecycle_status='active'
  for update;

  if not found or st.student_type<>'regular' then
    return jsonb_build_object('ok',false,'reason_code','cash_students_only');
  end if;

  if not exists(
    select 1 from public.assistant_conversations
    where id=p_conversation and studio_id=p_studio and student_id=st.id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  select * into old
  from public.demi_cash_purchases
  where id=p_key and studio_id=p_studio and conversation_id=p_conversation and student_id=p_student;

  if found then
    return jsonb_build_object(
      'ok',true,'idempotent',true,'sale_id',old.sale_id,
      'acquisition_id',old.acquisition_id,'payment_received',false
    );
  end if;

  select * into pt
  from public.product_templates
  where id=p_product and studio_id=p_studio and active and assistant_visible
    and product_type in ('package','membership');

  if not found or pt.price_minor<=0 then
    return jsonb_build_object('ok',false,'reason_code','cash_package_not_available');
  end if;

  eligibility := public.service_product_purchase_eligibility(p_studio,p_student,p_product);
  if coalesce((eligibility->>'eligible')::boolean,false) is not true then
    return jsonb_build_object(
      'ok',false,
      'reason_code',coalesce(eligibility->>'reason_code','product_not_eligible')
    );
  end if;

  if pt.enrollment_included then
    return jsonb_build_object('ok',false,'reason_code','included_enrollment_requires_online_or_staff_checkout');
  end if;

  if pt.price_minor is distinct from p_expected_amount then
    return jsonb_build_object('ok',false,'reason_code','purchase_price_changed');
  end if;

  if not exists(
    select 1 from public.studio_payment_methods
    where studio_id=p_studio and code='cash' and active
  ) then
    return jsonb_build_object('ok',false,'reason_code','cash_payment_disabled');
  end if;

  if exists(
    select 1
    from public.demi_cash_purchases c
    join public.sales s on s.id=c.sale_id and s.studio_id=c.studio_id
    where c.studio_id=p_studio and c.student_id=p_student and s.status='confirmed'
      and s.total_minor>(
        select coalesce(sum(case when kind='payment' then amount_minor else -amount_minor end),0)
        from public.payments where sale_id=s.id and studio_id=p_studio
      )
  ) then
    return jsonb_build_object('ok',false,'reason_code','cash_purchase_already_pending');
  end if;

  select (clock_timestamp() at time zone timezone)::date
  into today
  from public.studios
  where id=p_studio;

  insert into public.sales(
    id,studio_id,student_id,folio,status,currency,total_minor,idempotency_key,
    payment_due_on,collection_note,pending_access_exception,pending_access_exception_reason
  ) values(
    sale,p_studio,p_student,'V-CASH-'||upper(replace(sale::text,'-','')),
    'confirmed',pt.currency,pt.price_minor,p_key,today,
    'Efectivo declarado: pendiente de cobro. Una primera reserva permitida.',
    true,'Demi: efectivo declarado, acceso limitado a una primera reserva'
  );

  insert into public.sale_lines(
    studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor
  ) values(p_studio,sale,pt.id,pt.name,1,pt.price_minor,pt.price_minor)
  returning id into line;

  insert into public.product_acquisitions(
    studio_id,student_id,product_template_id,status,starts_on,expires_on,
    activation_mode,credit_limit,unlimited,sale_line_id,validity_days_snapshot
  ) values(
    p_studio,p_student,pt.id,'active',null,null,'first_usage',
    pt.credit_limit,pt.unlimited,line,pt.validity_days
  ) returning id into acquisition;

  if not pt.unlimited then
    insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note)
    values(p_studio,acquisition,'grant',pt.credit_limit,'Paquete pendiente de efectivo; no acredita pago recibido');
  end if;

  insert into public.demi_cash_purchases(
    id,studio_id,conversation_id,student_id,product_template_id,sale_id,acquisition_id
  ) values(p_key,p_studio,p_conversation,p_student,pt.id,sale,acquisition);

  return jsonb_build_object(
    'ok',true,'status','cash_due','sale_id',sale,'acquisition_id',acquisition,
    'amount_minor',pt.price_minor,'currency',pt.currency,'payment_received',false,
    'first_reservation_allowed',true,'starts_with_first_reservation',true
  );
end;
$function$
;
