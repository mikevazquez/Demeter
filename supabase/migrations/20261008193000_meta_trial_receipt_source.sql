-- Meta inbox receipts use their own event reference; WhatsApp behavior is unchanged.
alter table public.assistant_transfer_purchase_intents
  add column if not exists receipt_meta_inbox_event_id uuid
  references public.assistant_meta_inbox_events(id);
create index if not exists assistant_transfer_purchase_intents_meta_receipt_idx
  on public.assistant_transfer_purchase_intents(receipt_meta_inbox_event_id)
  where receipt_meta_inbox_event_id is not null;

CREATE OR REPLACE FUNCTION public.service_activate_trial_transfer_receipt(target_studio_id uuid, target_conversation_id uuid, target_student_id uuid, target_intent_id uuid, target_event_id uuid, target_provider_message_id text, target_media_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_intent public.assistant_transfer_purchase_intents%rowtype;
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
  if target_studio_id is null or target_conversation_id is null or target_student_id is null
     or target_intent_id is null or target_event_id is null
     or nullif(trim(coalesce(target_provider_message_id,'')),'') is null
     or nullif(trim(coalesce(target_media_id,'')),'') is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if not exists (
    select 1 from public.assistant_whatsapp_events e
    where e.id=target_event_id and e.studio_id=target_studio_id
  ) and not exists (
    select 1 from public.assistant_meta_inbox_events e
    where e.id=target_event_id and e.studio_id=target_studio_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','receipt_event_not_found');
  end if;

  select * into v_intent
  from public.assistant_transfer_purchase_intents
  where id=target_intent_id and studio_id=target_studio_id
    and conversation_id=target_conversation_id and student_id=target_student_id
    and intent_kind='trial_class'
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','pending_transfer_not_found'); end if;

  if v_intent.status='provisional_active' then
    if v_intent.receipt_provider_message_id=target_provider_message_id then
      return jsonb_build_object(
        'ok',true,'status','provisional_active','intent_id',v_intent.id,
        'sale_id',v_intent.sale_id,'reservation_id',v_intent.reservation_id,
        'idempotent',true,'payment_validation_required',true
      );
    end if;
    return jsonb_build_object('ok',false,'reason_code','transfer_already_has_receipt');
  end if;

  if v_intent.status<>'awaiting_receipt' then
    return jsonb_build_object('ok',false,'reason_code','transfer_not_awaiting_receipt');
  end if;
  if v_intent.expires_at<=clock_timestamp() then
    update public.assistant_transfer_purchase_intents
    set status='expired',updated_at=clock_timestamp() where id=v_intent.id;
    return jsonb_build_object('ok',false,'reason_code','transfer_intent_expired');
  end if;
  if coalesce(v_intent.receipt_amount_matches,false) is not true then
    return jsonb_build_object('ok',false,'reason_code','receipt_amount_not_matched');
  end if;

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
      v_intent.currency,v_intent.amount_minor,null,v_intent.id,v_sale_date,
      'Comprobante de primera clase recibido; transferencia pendiente de validación.',
      true,null,'Primera clase confirmada provisionalmente por comprobante con monto coincidente.'
    );

    insert into public.sale_lines(
      studio_id,sale_id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor
    ) values(
      target_studio_id,v_sale_id,v_product.id,'Primera clase',1,v_intent.amount_minor,v_intent.amount_minor
    )
    returning id into v_sale_line_id;
  end if;

  update public.assistant_reservation_links
  set payment_preference='bank_transfer',
      payment_preference_selected_at=coalesce(payment_preference_selected_at,clock_timestamp())
  where studio_id=target_studio_id and reservation_id=v_reservation_id;

  update public.assistant_transfer_purchase_intents
  set status='provisional_active',
      receipt_event_id=case when exists (select 1 from public.assistant_whatsapp_events e where e.id=target_event_id and e.studio_id=target_studio_id) then target_event_id else null end,
      receipt_meta_inbox_event_id=case when exists (select 1 from public.assistant_meta_inbox_events e where e.id=target_event_id and e.studio_id=target_studio_id) then target_event_id else null end,
      receipt_provider_message_id=target_provider_message_id,
      receipt_media_id=target_media_id,
      sale_id=v_sale_id,
      reservation_id=v_reservation_id,
      receipt_received_at=coalesce(receipt_received_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where id=v_intent.id;

  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,
    p_event_type=>'trial.payment_provisional',
    p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,
    p_deduplication_key=>'trial.payment_provisional:'||v_intent.id::text,
    p_actor_user_id=>(select auth.uid()),
    p_payload=>jsonb_build_object(
      'reservation_id',v_reservation_id,'student_id',target_student_id,
      'session_id',v_intent.session_id,'sale_id',v_sale_id,
      'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
      'source','assistant_trial_prepay'
    )
  );

  return jsonb_build_object(
    'ok',true,'status','provisional_active','intent_id',v_intent.id,
    'sale_id',v_sale_id,'reservation_id',v_reservation_id,
    'product_name','Primera clase','activity',coalesce(v_template.name,'Clase'),
    'amount_minor',v_intent.amount_minor,'currency',v_intent.currency,
    'payment_validation_required',true,'reservation_confirmed',true
  );
end;
$function$;


-- Keep the privileged activation callable by the service role only.
revoke all on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
