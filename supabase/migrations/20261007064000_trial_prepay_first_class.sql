alter table public.trial_booking_policies
  add column if not exists require_payment_before_booking boolean not null default false,
  add column if not exists trial_payment_product_template_id uuid references public.product_templates(id);

alter table public.assistant_transfer_purchase_intents
  add column if not exists intent_kind text not null default 'product_purchase',
  add column if not exists resource_id uuid references public.resources(id),
  add column if not exists reservation_id uuid references public.reservations(id);

alter table public.assistant_transfer_purchase_intents
  drop constraint if exists assistant_transfer_purchase_intents_intent_kind_check;

alter table public.assistant_transfer_purchase_intents
  add constraint assistant_transfer_purchase_intents_intent_kind_check
  check (intent_kind in ('product_purchase','trial_class'));

create index if not exists assistant_transfer_purchase_intents_trial_pending_idx
  on public.assistant_transfer_purchase_intents(studio_id,conversation_id,student_id,created_at desc)
  where intent_kind='trial_class' and status='awaiting_receipt';

insert into public.product_templates(
  studio_id,name,description,product_type,price_minor,currency,
  credit_limit,validity_days,unlimited,active,online_purchasable,
  reward_discount_eligible,reward_credit_wallet,assistant_visible
)
select
  p.studio_id,
  'Primera clase · pago anticipado',
  'Producto interno para registrar el cobro de la primera clase. No se muestra en catálogos.',
  'other'::public.product_type,
  0,
  upper(coalesce(s.currency,'MXN')),
  1,
  1,
  false,
  false,
  false,
  false,
  false,
  false
from public.trial_booking_policies p
join public.studios s on s.id=p.studio_id
where not exists(
  select 1
  from public.product_templates pt
  where pt.studio_id=p.studio_id
    and pt.name='Primera clase · pago anticipado'
);

update public.trial_booking_policies p
set trial_payment_product_template_id = (
  select pt.id
  from public.product_templates pt
  where pt.studio_id=p.studio_id
    and pt.name='Primera clase · pago anticipado'
  order by pt.created_at asc
  limit 1
)
where p.trial_payment_product_template_id is null;

create or replace function public.service_prepare_trial_transfer(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_resource_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_policy public.trial_booking_policies%rowtype;
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_bank public.studio_bank_transfer_settings%rowtype;
  v_product public.product_templates%rowtype;
  v_attended integer := 0;
  v_active integer := 0;
  v_occupied integer := 0;
  v_intent_id uuid;
  v_currency text;
begin
  if target_studio_id is null or target_conversation_id is null or target_student_id is null or target_session_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_policy from public.trial_booking_policies where studio_id=target_studio_id;
  if not found or not v_policy.enabled then
    return jsonb_build_object('ok',false,'reason_code','trial_booking_disabled');
  end if;
  if not coalesce(v_policy.require_payment_before_booking,false) then
    return jsonb_build_object('ok',false,'reason_code','trial_prepay_not_enabled');
  end if;
  if v_policy.trial_payment_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','trial_payment_product_missing');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id and studio_id=target_studio_id
    and active=true and lifecycle_status='active'
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_operable'); end if;
  if v_student.student_type <> 'trial' then
    return jsonb_build_object('ok',false,'reason_code','trial_identity_required');
  end if;

  if not exists(
    select 1 from public.assistant_conversations c
    where c.id=target_conversation_id and c.studio_id=target_studio_id and c.student_id=target_student_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  select count(*)::integer into v_attended
  from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='attended';
  if v_attended>0 then
    return jsonb_build_object('ok',false,'reason_code','trial_completed_enrollment_required');
  end if;

  select count(*)::integer into v_active
  from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='reserved';
  if v_active>=v_policy.max_active_trial_reservations then
    return jsonb_build_object('ok',false,'reason_code','trial_active_booking_exists');
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id and studio_id=target_studio_id
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=clock_timestamp() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;

  select count(*)::integer into v_occupied
  from public.reservations
  where session_id=target_session_id and status in ('reserved','attended');
  if v_occupied>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if coalesce(v_session.requires_resource,false) then
    if target_resource_id is null then
      return jsonb_build_object('ok',false,'reason_code','resource_selection_required');
    end if;
    if not exists(
      select 1
      from public.session_resources sr
      join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
      where sr.studio_id=target_studio_id
        and sr.session_id=target_session_id
        and sr.resource_id=target_resource_id
        and sr.enabled=true and r.active=true
    ) then
      return jsonb_build_object('ok',false,'reason_code','resource_not_available');
    end if;
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id and studio_id=target_studio_id and active=true;
  if not found or coalesce(15000,0)<=0 then
    return jsonb_build_object('ok',false,'reason_code','trial_price_unavailable');
  end if;

  select * into v_product
  from public.product_templates
  where id=v_policy.trial_payment_product_template_id and studio_id=target_studio_id;
  if not found then return jsonb_build_object('ok',false,'reason_code','trial_payment_product_missing'); end if;

  if not exists(
    select 1 from public.studio_payment_methods spm
    where spm.studio_id=target_studio_id and spm.active=true
      and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank
  from public.studio_bank_transfer_settings
  where studio_id=target_studio_id and enabled=true;
  if not found
     or nullif(trim(coalesce(v_bank.bank_name,'')),'') is null
     or nullif(trim(coalesce(v_bank.account_holder,'')),'') is null
     or (
       nullif(trim(coalesce(v_bank.clabe,'')),'') is null
       and nullif(trim(coalesce(v_bank.account_number,'')),'') is null
       and nullif(trim(coalesce(v_bank.card_number,'')),'') is null
     ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_details_not_configured');
  end if;

  select upper(coalesce(currency,'MXN')) into v_currency from public.studios where id=target_studio_id;

  update public.assistant_transfer_purchase_intents
  set status='cancelled',updated_at=clock_timestamp()
  where studio_id=target_studio_id and conversation_id=target_conversation_id
    and intent_kind='trial_class' and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,session_id,product_template_id,
    amount_minor,currency,status,intent_kind,resource_id
  )
  values(
    target_studio_id,target_conversation_id,target_student_id,target_session_id,
    v_product.id,15000,v_currency,'awaiting_receipt',
    'trial_class',case when v_session.requires_resource then target_resource_id else null end
  )
  returning id into v_intent_id;

  return jsonb_build_object(
    'ok',true,'status','awaiting_receipt','intent_id',v_intent_id,
    'amount_minor',15000,'currency',v_currency,
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,'instructions',v_bank.instructions
    ),
    'receipt_required',true,'reservation_confirmed',false,
    'activation_rule','confirm_trial_on_matching_receipt'
  );
end;
$function$;

create or replace function public.service_activate_trial_transfer_receipt(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_intent_id uuid,
  target_event_id uuid,
  target_provider_message_id text,
  target_media_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
      receipt_event_id=target_event_id,
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

create or replace function private.sync_trial_transfer_review()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.intent_kind<>'trial_class' then return new; end if;

  if new.status='rejected' and old.status is distinct from new.status and new.reservation_id is not null then
    update public.reservations
    set status='cancelled_by_studio',
        cancelled_at=clock_timestamp(),
        cancellation_reason='Primera clase revocada: transferencia no validada.',
        cancelled_by=new.reviewed_by,
        updated_at=clock_timestamp()
    where id=new.reservation_id and studio_id=new.studio_id and status='reserved';
  end if;

  if new.status='validated' and old.status is distinct from new.status
     and new.sale_id is not null and new.reservation_id is not null then
    update public.payments
    set reservation_id=new.reservation_id
    where sale_id=new.sale_id and studio_id=new.studio_id and reservation_id is null;
  end if;

  return new;
end;
$function$;

drop trigger if exists sync_trial_transfer_review on public.assistant_transfer_purchase_intents;
create trigger sync_trial_transfer_review
after update of status on public.assistant_transfer_purchase_intents
for each row execute function private.sync_trial_transfer_review();

revoke all on function public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid) from public;
revoke all on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) from public;
grant execute on function public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.service_activate_trial_transfer_receipt(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
