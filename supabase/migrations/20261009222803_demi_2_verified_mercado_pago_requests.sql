-- Provider proof is separate from uploaded bank receipts; no fake Meta events.
create table public.demi_mercadopago_settings (
 studio_id uuid primary key references public.studios(id), enabled boolean not null default false,
 updated_by uuid, updated_at timestamptz not null default clock_timestamp()
);
alter table public.demi_mercadopago_settings enable row level security;
revoke all on public.demi_mercadopago_settings from public,anon,authenticated;
grant all on public.demi_mercadopago_settings to service_role;
grant select on public.demi_mercadopago_settings to authenticated;
create policy demi_mp_settings_admin on public.demi_mercadopago_settings for select to authenticated using(private.has_capability(studio_id,'settings.write'));
create function public.admin_set_demi_mercadopago(p_studio uuid,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_capability(p_studio,'settings.write') then raise exception 'forbidden'; end if;
 insert into public.demi_mercadopago_settings(studio_id,enabled,updated_by) values(p_studio,coalesce(p_enabled,false),auth.uid()) on conflict(studio_id) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return jsonb_build_object('ok',true,'enabled',coalesce(p_enabled,false));
end; $$;
revoke all on function public.admin_set_demi_mercadopago(uuid,boolean) from public,anon;
grant execute on function public.admin_set_demi_mercadopago(uuid,boolean) to authenticated;

create table public.demi_payment_requests (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null unique references public.demi_group_bookings(id),
 studio_id uuid not null references public.studios(id),
 conversation_id uuid not null references public.assistant_conversations(id),
 amount_minor integer not null check(amount_minor>0), currency text not null check(currency='MXN'),
 external_reference text not null unique,
 provider_order_id text unique, provider_payment_id text unique, checkout_url text,
 status text not null default 'created' check(status in ('created','order_created','pending','approved','rejected','cancelled','error')),
 provider_status text, provider_status_detail text, failure_code text,
 verified_at timestamptz, last_checked_at timestamptz, created_at timestamptz not null default clock_timestamp(),
 notification_status text not null default 'none' check(notification_status in ('none','pending','claimed','sent','review')),
 notification_lease uuid, notification_claimed_at timestamptz, notification_attempts integer not null default 0,
 notification_error text, notification_provider_id text,
 constraint demi_mp_approved_proof check(status<>'approved' or (provider_order_id is not null and provider_payment_id is not null and verified_at is not null))
);
alter table public.demi_payment_requests enable row level security;
revoke all on public.demi_payment_requests from public,anon,authenticated;
grant all on public.demi_payment_requests to service_role;
create index demi_payment_requests_pending on public.demi_payment_requests(last_checked_at) where status in ('order_created','pending','error');

create function public.service_prepare_demi_mercadopago(p_studio uuid,p_conversation uuid,p_group uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; r public.demi_payment_requests%rowtype; request_id uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.demi_mercadopago_settings where studio_id=p_studio and enabled) then return jsonb_build_object('ok',false,'reason_code','mercadopago_disabled'); end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if not exists(select 1 from public.assistant_conversations where id=p_conversation and studio_id=p_studio) then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 select * into r from public.demi_payment_requests where group_id=g.id;
 if found then return jsonb_build_object('ok',true,'request_id',r.id,'status',r.status,'external_reference',r.external_reference,'amount_minor',r.amount_minor,'currency',r.currency,'checkout_url',r.checkout_url,'provider_order_id',r.provider_order_id,'idempotent',true); end if;
 if g.status<>'awaiting_receipt' or g.receipt_event_id is not null or g.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'reason_code','payment_not_awaiting_provider'); end if;
 if g.currency<>'MXN' then return jsonb_build_object('ok',false,'reason_code','unsupported_currency'); end if;
 if not exists(select 1 from public.class_sessions s where s.id=g.session_id and s.studio_id=p_studio and s.status='scheduled' and s.starts_at>clock_timestamp()+interval '30 minutes') then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 insert into public.demi_payment_requests(id,group_id,studio_id,conversation_id,amount_minor,currency,external_reference) values(request_id,g.id,p_studio,p_conversation,g.amount_minor,g.currency,'demi:'||request_id);
 return jsonb_build_object('ok',true,'request_id',request_id,'status','created','external_reference','demi:'||request_id,'amount_minor',g.amount_minor,'currency',g.currency);
end; $$;
revoke all on function public.service_prepare_demi_mercadopago(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_prepare_demi_mercadopago(uuid,uuid,uuid) to service_role;

create function public.service_apply_demi_mercadopago_order(p_request uuid,p_order jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.demi_payment_requests%rowtype; payment jsonb; new_status text; amount numeric; paid numeric;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into r from public.demi_payment_requests where id=p_request for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','payment_request_not_found'); end if;
 if r.provider_order_id is null or p_order->>'id' is distinct from r.provider_order_id or p_order->>'external_reference' is distinct from r.external_reference then return jsonb_build_object('ok',false,'reason_code','provider_identity_mismatch'); end if;
 if p_order->>'status'='processed' and p_order->>'status_detail'='accredited' then
  if coalesce(p_order->>'total_amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' or coalesce(p_order->>'total_paid_amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then return jsonb_build_object('ok',false,'reason_code','provider_amount_missing'); end if;
  amount:=(p_order->>'total_amount')::numeric*100; paid:=(p_order->>'total_paid_amount')::numeric*100;
  if amount<>r.amount_minor or paid<>r.amount_minor or upper(p_order->>'currency') is distinct from r.currency then return jsonb_build_object('ok',false,'reason_code','provider_amount_or_currency_mismatch'); end if;
  if jsonb_typeof(p_order#>'{transactions,payments}') is distinct from 'array' then return jsonb_build_object('ok',false,'reason_code','provider_payment_missing'); end if;
  select x into payment from jsonb_array_elements(p_order#>'{transactions,payments}') x where x->>'status'='processed' and x->>'status_detail'='accredited' and nullif(x->>'id','') is not null and coalesce(x->>'paid_amount',x->>'amount','') ~ '^[0-9]+(\.[0-9]{1,2})?$' and coalesce(x->>'paid_amount',x->>'amount')::numeric*100=r.amount_minor;
  if payment is null then return jsonb_build_object('ok',false,'reason_code','provider_payment_missing'); end if;
  if r.status='approved' then
   if r.provider_payment_id is distinct from payment->>'id' then return jsonb_build_object('ok',false,'reason_code','provider_payment_identity_changed'); end if;
   return jsonb_build_object('ok',true,'status','approved','idempotent',true,'request_id',r.id);
  end if;
  -- Uploaded proof and gateway proof must not pay the same group twice.
  if exists(select 1 from public.demi_group_bookings where id=r.group_id and (receipt_event_id is not null or status in ('provisional','validated','rejected'))) then
   perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'refund_request','Mercado Pago recibió un pago para una solicitud ya resuelta por otro medio. Revisar manualmente; no se aplicó un segundo pago. Solicitud: '||r.id);
   update public.demi_payment_requests set failure_code='payment_route_conflict',last_checked_at=clock_timestamp() where id=r.id;
   return jsonb_build_object('ok',false,'reason_code','payment_route_conflict');
  end if;
  update public.demi_payment_requests set status='approved',provider_payment_id=payment->>'id',verified_at=clock_timestamp(),last_checked_at=clock_timestamp(),provider_status='processed',provider_status_detail='accredited',failure_code=null,notification_status='pending' where id=r.id;
  update public.demi_group_bookings set status='awaiting_participants' where id=r.group_id and status='awaiting_receipt';
  return jsonb_build_object('ok',true,'status','approved','request_id',r.id,'participant_data_required',true,'reservation_confirmed',false);
 end if;
 if r.status='approved' then
  if p_order->>'status' in ('refunded','charged_back','canceled','cancelled') then perform public.assistant_create_handoff(r.studio_id,r.conversation_id,null,'refund_request','Cambio posterior al pago aprobado de Mercado Pago: '||r.id||'. Revisar manualmente; no se revocaron derechos automáticamente.'); end if;
  return jsonb_build_object('ok',true,'status','approved','idempotent',true);
 end if;
 new_status:=case when p_order->>'status'='created' then 'order_created' when p_order->>'status' in ('pending','processing','action_required','authorized','in_process') then 'pending' when p_order->>'status' in ('failed','rejected') then 'rejected' when p_order->>'status' in ('canceled','cancelled','refunded','charged_back') then 'cancelled' else 'error' end;
 update public.demi_payment_requests set status=new_status,provider_status=p_order->>'status',provider_status_detail=p_order->>'status_detail',last_checked_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('ok',true,'status',new_status,'reservation_confirmed',false);
end; $$;
revoke all on function public.service_apply_demi_mercadopago_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_apply_demi_mercadopago_order(uuid,jsonb) to service_role;

alter table public.assistant_reservation_links drop constraint assistant_reservation_links_payment_preference_check;
alter table public.assistant_reservation_links add constraint assistant_reservation_links_payment_preference_check check(payment_preference is null or payment_preference in ('cash','bank_transfer','mercado_pago'));

create or replace function public.service_activate_demi_paid_trial(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_intent_id uuid,
  target_request_id uuid,
  target_ordinal integer
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_intent public.assistant_transfer_purchase_intents%rowtype;
  v_request public.demi_payment_requests%rowtype;
  v_booking jsonb;
  v_reservation_id uuid;
  v_sale_id uuid;
  v_sale_line_id uuid;
  v_sale_date date;
  v_timezone text;
  v_folio text;
  v_product public.product_templates%rowtype;
  v_template public.class_templates%rowtype;
  v_session public.class_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  select r.* into v_request from public.demi_payment_requests r join public.demi_group_bookings g on g.id=r.group_id and g.studio_id=r.studio_id and g.conversation_id=r.conversation_id join public.assistant_conversations c on c.id=target_conversation_id and c.studio_id=r.studio_id and c.student_id=target_student_id and c.context->>'group_id'=r.group_id::text where r.id=target_request_id and r.studio_id=target_studio_id and r.status='approved' and r.verified_at is not null for update of r;
  if not found then return jsonb_build_object('ok',false,'reason_code','verified_payment_required'); end if;
  select * into v_intent from public.assistant_transfer_purchase_intents where id=target_intent_id and studio_id=target_studio_id and student_id=target_student_id and conversation_id=target_conversation_id and intent_kind='trial_class' for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','pending_transfer_not_found'); end if;
  if v_intent.status='validated' then return jsonb_build_object('ok',true,'status','validated','reservation_id',v_intent.reservation_id,'payment_validation_required',false,'idempotent',true); end if;
  if v_intent.status<>'awaiting_receipt' or v_intent.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'reason_code','payment_intent_not_available'); end if;
  if target_ordinal<1 or target_ordinal>(select participant_count from public.demi_group_bookings where id=v_request.group_id) or v_intent.session_id is distinct from (select session_id from public.demi_group_bookings where id=v_request.group_id) or v_intent.amount_minor is distinct from v_request.amount_minor/(select transfer_count from public.demi_group_bookings where id=v_request.group_id) then return jsonb_build_object('ok',false,'reason_code','payment_allocation_mismatch'); end if;
  select * into v_session
  from public.class_sessions
  where id=v_intent.session_id and studio_id=target_studio_id;
  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;

  if v_intent.resource_id is not null then
    v_booking := public.service_confirm_trial_booking_with_resource(
      target_studio_id,v_intent.session_id,target_student_id,null,target_conversation_id,v_intent.resource_id
    );
  else
    v_booking := public.assistant_confirm_trial_booking(
      target_studio_id,v_intent.session_id,target_student_id,null,target_conversation_id
    );
  end if;

  if coalesce((v_booking->>'ok')::boolean,false) is not true then return v_booking; end if;

  v_reservation_id := nullif(v_booking->>'reservation_id','')::uuid;
  if v_reservation_id is null then raise exception 'trial_booking_missing_reservation'; end if;

  update public.reservations
  set commercial_status='paid',updated_at=clock_timestamp()
  where id=v_reservation_id and studio_id=target_studio_id;

  select * into v_product
  from public.product_templates
  where id=v_intent.product_template_id and studio_id=target_studio_id;
  if not found then raise exception 'trial_payment_product_missing'; end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id and studio_id=target_studio_id;

  select timezone into v_timezone from public.studios where id=target_studio_id;
  v_sale_date := (clock_timestamp() at time zone coalesce(v_timezone,'America/Mexico_City'))::date;

  select id into v_sale_id
  from public.sales
  where studio_id=target_studio_id and idempotency_key=v_intent.id;

  if v_sale_id is null then
    v_sale_id := gen_random_uuid();
    v_folio := 'V-' || to_char(v_sale_date,'YYYYMMDD') || '-' ||
      upper(substr(replace(v_sale_id::text,'-',''),1,12));

    insert into public.sales(
      id,studio_id,student_id,folio,status,currency,total_minor,created_by,
      idempotency_key,payment_due_on,collection_note,pending_access_exception,
      pending_access_exception_by,pending_access_exception_reason
    ) values(
      v_sale_id,target_studio_id,target_student_id,v_folio,'confirmed',
      v_intent.currency,v_intent.amount_minor,null,v_intent.id,null,
      null, false,null,null
    );

    insert into public.sale_lines(
      studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor
    ) values(
      target_studio_id,v_sale_id,v_product.id,'Primera clase',1,v_intent.amount_minor,v_intent.amount_minor
    )
    returning id into v_sale_line_id;
  end if;

  update public.assistant_reservation_links
  set payment_preference='mercado_pago',
      payment_preference_selected_at=coalesce(payment_preference_selected_at,clock_timestamp())
  where studio_id=target_studio_id and reservation_id=v_reservation_id;

  update public.assistant_transfer_purchase_intents
  set status='provisional_active',
      sale_id=v_sale_id,
      reservation_id=v_reservation_id,
      updated_at=clock_timestamp()
  where id=v_intent.id;

  insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,effective_on,reservation_id)
  values(target_studio_id,v_sale_id,'payment',v_intent.amount_minor,'mercado_pago',v_request.provider_payment_id||':demi:'||target_ordinal,'Mercado Pago Order '||v_request.provider_order_id,v_sale_date,v_reservation_id);
  update public.assistant_transfer_purchase_intents set status='validated',validated_at=clock_timestamp(),review_note='Pago verificado automáticamente por Mercado Pago',updated_at=clock_timestamp() where id=v_intent.id;
  return jsonb_build_object(
    'ok',true,'status','validated','intent_id',v_intent.id,
    'sale_id',v_sale_id,'reservation_id',v_reservation_id,
    'product_name','Primera clase','activity',coalesce(v_template.name,'Clase'),
    'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
    'payment_validation_required',false,'reservation_confirmed',true
  );
end;
$function$;

revoke all on function public.service_activate_demi_paid_trial(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.service_activate_demi_paid_trial(uuid,uuid,uuid,uuid,uuid,integer) to service_role;

create or replace function public.service_complete_demi_group(p_studio uuid,p_conversation uuid,p_group uuid,p_participants jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; item jsonb; idx integer:=0; st public.students%rowtype;
 person uuid; contact uuid; child uuid; intent uuid; allocation integer; total integer; r jsonb; out jsonb:='[]'; n integer; slot public.demi_group_participants%rowtype; gateway uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 select id into gateway from public.demi_payment_requests where group_id=g.id and studio_id=p_studio and conversation_id=p_conversation and status='approved' and verified_at is not null;
 if g.status not in ('awaiting_participants','partial','provisional','validated') or (g.receipt_event_id is null and gateway is null) then return jsonb_build_object('ok',false,'reason_code','receipt_required_before_participants'); end if;
 if jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)<>g.participant_count then return jsonb_build_object('ok',false,'reason_code','participant_count_mismatch'); end if;
 if exists(select 1 from jsonb_array_elements(p_participants) x where coalesce(x->>'phone','') !~ '^[0-9]{10}$' or length(trim(coalesce(x->>'name','')))<3)
 then return jsonb_build_object('ok',false,'reason_code','participant_data_required'); end if;
 if g.prospect_contact_id is not null and not exists(select 1 from public.crm_contacts cc join public.person_contacts pc on pc.studio_id=cc.studio_id and pc.person_id=cc.person_id and pc.kind='phone' where cc.id=g.prospect_contact_id and cc.studio_id=p_studio and right(pc.value,10)=p_participants->0->>'phone') then return jsonb_build_object('ok',false,'reason_code','participant_phone_mismatch'); end if;
 if (select count(distinct x->>'phone') from jsonb_array_elements(p_participants) x)<>g.participant_count then
  perform public.assistant_create_handoff(p_studio,p_conversation,null,'group_duplicate_phone','Dos participantes comparten teléfono; no se inventó ni se fusionó identidad.');
  return jsonb_build_object('ok',false,'reason_code','duplicate_participant_phone');
 end if;
 if exists(select 1 from public.demi_group_participants gp join jsonb_array_elements(p_participants) with ordinality x(value,ordinal) on x.ordinal=gp.ordinal where gp.group_id=g.id and gp.phone is distinct from x.value->>'phone') then return jsonb_build_object('ok',false,'reason_code','participant_identity_changed'); end if;
 if g.status in ('validated','provisional') then
  select coalesce(jsonb_agg(gp.result||jsonb_build_object('reservation_status',r.status,'reservation_confirmed',coalesce(r.status='reserved',false)) order by gp.ordinal),'[]'::jsonb),count(*) filter(where r.status='reserved'),coalesce(sum(gp.allocated_minor),0) into out,n,total from public.demi_group_participants gp left join public.reservations r on r.id=gp.reservation_id and r.studio_id=p_studio where gp.group_id=g.id;
  return jsonb_build_object('ok',true,'status',g.status,'participants',out,'reserved_count',n,'allocated_minor',total,'unallocated_minor',g.amount_minor-total,'payment_validation_required',g.status='provisional','idempotent',true);
 end if;
 if not exists(select 1 from public.class_sessions where id=g.session_id and studio_id=p_studio and status='scheduled' and starts_at>clock_timestamp()+interval '30 minutes') then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
 -- All rows lock the session in one transaction; concurrent groups cannot oversell.
 perform 1 from public.class_sessions where id=g.session_id and studio_id=p_studio for update;
 for item in select value from jsonb_array_elements(p_participants) loop
  idx:=idx+1;
  select * into slot from public.demi_group_participants where group_id=g.id and ordinal=idx;
  if found and slot.phone<>item->>'phone' then return jsonb_build_object('ok',false,'reason_code','participant_identity_changed'); end if;
  if slot.reservation_id is not null then
   select jsonb_build_object('reservation_status',rv.status,'reservation_confirmed',rv.status='reserved') into r from public.reservations rv where rv.id=slot.reservation_id and rv.studio_id=p_studio;
   out:=out||jsonb_build_array(slot.result||coalesce(r,jsonb_build_object('reservation_confirmed',false))||jsonb_build_object('idempotent',true)); continue;
  end if;
  begin
   select * into st from public.students where studio_id=p_studio and phone='+52'||(item->>'phone') and lifecycle_status<>'archived' for update;
   if not found then
    select pc.person_id into person from public.person_contacts pc join public.crm_contacts cc on cc.person_id=pc.person_id and cc.studio_id=pc.studio_id where pc.studio_id=p_studio and pc.kind='phone' and pc.value='+52'||(item->>'phone') limit 1;
    if person is null then
     insert into public.persons(studio_id,first_name,last_name) values(p_studio,trim(item->>'name'),null) returning id into person;
     insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(p_studio,person,'phone','+52'||(item->>'phone'),true);
    end if;
    insert into public.crm_contacts(studio_id,person_id,lifecycle_status,source) values(p_studio,person,'prospect','demi_group') on conflict do nothing;
    select id into contact from public.crm_contacts where studio_id=p_studio and person_id=person;
    if g.prospect_contact_id is not null then update public.persons set first_name=trim(item->>'name'),last_name=null where id=person and studio_id=p_studio; end if;
    r:=public.assistant_ensure_trial_student(p_studio,contact);
    if not coalesce((r->>'ok')::boolean,false) then raise exception 'group_identity:%',r; end if;
    select * into st from public.students where id=(r->>'student_id')::uuid;
   end if;
   allocation:=0;
   if st.student_type='trial' and st.trial_status is distinct from 'attended' and st.trial_status is distinct from 'converted' then
    if exists(select 1 from public.reservations where studio_id=p_studio and student_id=st.id and status='reserved') then
     r:=jsonb_build_object('ok',false,'reason_code','trial_reservation_already_pending');
    else
     allocation:=g.amount_minor/g.transfer_count;
     select coalesce(sum(allocated_minor),0) into total from public.demi_group_participants where group_id=g.id and ordinal<>idx;
     if total+allocation>g.amount_minor then raise exception 'group_allocation_exceeded'; end if;
     child:=gen_random_uuid();
     insert into public.assistant_conversations(id,studio_id,student_id,channel,context) values(child,p_studio,st.id,'internal_demo',jsonb_build_object('group_id',g.id,'payer_conversation',g.conversation_id));
     r:=public.service_prepare_trial_transfer(p_studio,child,st.id,g.session_id,g.resource_id);
     if coalesce((r->>'ok')::boolean,false) then
      intent:=(r->>'intent_id')::uuid;
      if (select amount_minor from public.assistant_transfer_purchase_intents where id=intent)<>allocation then raise exception 'group_quote_changed'; end if;
      if gateway is not null then
       r:=public.service_activate_demi_paid_trial(p_studio,child,st.id,intent,gateway,idx);
      else
       update public.assistant_transfer_purchase_intents set receipt_amount_matches=true,receipt_storage_path=g.receipt_path where id=intent;
       r:=public.service_activate_trial_transfer_receipt(p_studio,child,st.id,intent,g.receipt_event_id,'group-allocation:'||g.id||':'||idx,g.receipt_media_id);
      end if;
     end if;
    end if;
   else
    r:=public.service_book_student(p_studio,g.session_id,st.id);
    r:=r||jsonb_build_object('ok',coalesce((r->>'eligible')::boolean,false));
   end if;
   if not coalesce((r->>'ok')::boolean,false) then raise exception using errcode='P2001',message='participant_booking_failed'; end if;
   if not coalesce((r->>'ok')::boolean,false) then allocation:=0; end if;
   if coalesce((r->>'ok')::boolean,false) and g.prospect_contact_id is not null then
    update public.assistant_conversations set student_id=st.id,context=coalesce(context,'{}'::jsonb)||jsonb_build_object('identity_needs_name',false) where id=g.conversation_id and studio_id=p_studio;
   end if;
   r:=r||jsonb_build_object('ordinal',idx,'participant_name',item->>'name');
   insert into public.demi_group_participants(group_id,ordinal,student_id,reservation_id,transfer_intent_id,allocated_minor,phone,result)
   values(g.id,idx,st.id,nullif(r->>'reservation_id','')::uuid,intent,allocation,item->>'phone',r)
   on conflict(group_id,ordinal) do update set student_id=excluded.student_id,reservation_id=excluded.reservation_id,transfer_intent_id=excluded.transfer_intent_id,allocated_minor=excluded.allocated_minor,result=excluded.result;
  exception when others then
   r:=jsonb_build_object('ok',false,'ordinal',idx,'participant_name',item->>'name','reason_code',case when sqlstate='P2001' then coalesce(r->>'reason_code','participant_booking_failed') else 'participant_operation_failed' end,'error_code',sqlstate);
   insert into public.demi_group_participants(group_id,ordinal,phone,result) values(g.id,idx,item->>'phone',r)
   on conflict(group_id,ordinal) do update set result=excluded.result;
  end;
  out:=out||jsonb_build_array(r);
  person:=null; contact:=null; intent:=null; slot:=null;
 end loop;
 select count(*) filter(where rv.status='reserved'),coalesce(sum(gp.allocated_minor),0) into n,total from public.demi_group_participants gp left join public.reservations rv on rv.id=gp.reservation_id and rv.studio_id=p_studio where gp.group_id=g.id;
 update public.demi_group_bookings set status=case when n=g.participant_count and total=g.amount_minor then case when gateway is not null then 'validated' else 'provisional' end else 'partial' end where id=g.id;
 if n<>g.participant_count or total<>g.amount_minor then perform public.assistant_create_handoff(p_studio,p_conversation,null,'group_partial','Resultado parcial de grupo '||g.id||'; revisar reservas e importe no asignado.'); end if;
 return jsonb_build_object('ok',n=g.participant_count and total=g.amount_minor,'status',case when n=g.participant_count and total=g.amount_minor then case when gateway is not null then 'validated' else 'provisional' end else 'partial' end,'participants',out,'reserved_count',n,'allocated_minor',total,'unallocated_minor',g.amount_minor-total,'payment_validation_required',gateway is null);
end; $$;


create or replace function public.service_complete_demi_meta_group(p_studio uuid,p_conversation uuid,p_group uuid,p_participants jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; ac public.assistant_conversations%rowtype; person uuid; v_phone text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into ac from public.assistant_conversations where id=p_conversation and studio_id=p_studio and channel in ('facebook_messenger','instagram');
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if (g.receipt_event_id is null and not exists(select 1 from public.demi_payment_requests where group_id=g.id and studio_id=p_studio and conversation_id=p_conversation and status='approved' and verified_at is not null)) or g.status not in ('awaiting_participants','partial','provisional','validated') then return jsonb_build_object('ok',false,'reason_code','receipt_required_before_participants'); end if;
 if jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)<>g.participant_count then return jsonb_build_object('ok',false,'reason_code','participant_count_mismatch'); end if;
 if exists(select 1 from jsonb_array_elements(p_participants) x where coalesce(x->>'phone','') !~ '^[0-9]{10}$' or length(trim(coalesce(x->>'name','')))<3) then return jsonb_build_object('ok',false,'reason_code','participant_data_required'); end if;
 if g.prospect_contact_id is not null then
  select cc.person_id into person from public.crm_contacts cc join public.assistant_channel_identities i on i.studio_id=cc.studio_id and i.crm_contact_id=cc.id and i.person_id=cc.person_id where cc.id=g.prospect_contact_id and cc.studio_id=p_studio and ac.context->>'crm_contact_id'=cc.id::text and ac.context->>'identity_id'=i.id::text and i.provider=ac.channel and ac.context->>'provider_account_id'=i.provider_account_id and ac.context->>'provider_contact_id'=i.provider_contact_id;
  if person is null or g.participant_count<>1 then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
  v_phone:='+52'||(p_participants->0->>'phone');
  perform pg_advisory_xact_lock(hashtextextended(p_studio::text||v_phone,0));
  if exists(select 1 from public.person_contacts where studio_id=p_studio and kind='phone' and value=v_phone and person_id<>person) or exists(select 1 from public.students where studio_id=p_studio and phone=v_phone and person_id is distinct from person) then
   perform public.assistant_create_handoff(p_studio,p_conversation,ac.student_id,'technical_block','El celular escrito en Meta pertenece a otra ficha; no se vinculó ni reservó.');
   return jsonb_build_object('ok',false,'reason_code','participant_identity_requires_review');
  end if;
  if exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person and kind='phone' and value<>v_phone) then return jsonb_build_object('ok',false,'reason_code','participant_phone_mismatch'); end if;
  if not exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person and kind='phone' and value=v_phone) then insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(p_studio,person,'phone',v_phone,true); end if;
 else
  -- A typed phone cannot spend another student's credits from an unverified Meta identity.
  if exists(select 1 from jsonb_array_elements(p_participants) x join public.students st on st.studio_id=p_studio and st.phone='+52'||(x->>'phone') where st.id is distinct from ac.student_id) then
   perform public.assistant_create_handoff(p_studio,p_conversation,ac.student_id,'technical_block','Un participante de Meta usa una ficha existente que requiere verificación.');
   return jsonb_build_object('ok',false,'reason_code','participant_identity_requires_review');
  end if;
 end if;
 return public.service_complete_demi_group(p_studio,p_conversation,p_group,p_participants);
end; $$;
revoke all on function public.service_complete_demi_meta_group(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_complete_demi_meta_group(uuid,uuid,uuid,jsonb) to service_role;
