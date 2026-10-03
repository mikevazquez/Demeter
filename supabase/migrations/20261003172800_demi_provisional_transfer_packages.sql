-- Provisional transfer purchases for Demi.
-- A receipt activates a package immediately, but the purchase remains revocable until reviewed.

create table if not exists public.assistant_transfer_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  product_template_id uuid not null references public.product_templates(id),
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null,
  status text not null default 'awaiting_receipt'
    check (status in (
      'awaiting_receipt',
      'provisional_active',
      'validated',
      'rejected',
      'cancelled',
      'expired'
    )),
  receipt_event_id uuid references public.assistant_whatsapp_events(id),
  receipt_provider_message_id text,
  receipt_media_id text,
  sale_id uuid references public.sales(id),
  acquisition_id uuid references public.product_acquisitions(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  receipt_received_at timestamptz,
  validated_at timestamptz,
  rejected_at timestamptz,
  reviewed_by uuid,
  review_note text
);

create unique index if not exists assistant_transfer_purchase_one_open_per_conversation
on public.assistant_transfer_purchase_intents(studio_id, conversation_id)
where status in ('awaiting_receipt','provisional_active');

create unique index if not exists assistant_transfer_purchase_receipt_unique
on public.assistant_transfer_purchase_intents(studio_id, receipt_provider_message_id)
where receipt_provider_message_id is not null;

create index if not exists assistant_transfer_purchase_review_queue_idx
on public.assistant_transfer_purchase_intents(studio_id, status, receipt_received_at desc);

alter table public.assistant_transfer_purchase_intents enable row level security;

revoke all on table public.assistant_transfer_purchase_intents from public, anon;
grant select on table public.assistant_transfer_purchase_intents to authenticated, service_role;
grant insert, update on table public.assistant_transfer_purchase_intents to service_role;

drop policy if exists assistant_transfer_purchase_admin_read
on public.assistant_transfer_purchase_intents;
create policy assistant_transfer_purchase_admin_read
on public.assistant_transfer_purchase_intents
for select
to authenticated
using (private.has_capability(studio_id, 'sales.read'));


create or replace function public.service_prepare_transfer_purchase(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_product_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_bank public.studio_bank_transfer_settings%rowtype;
  v_has_activity_scope boolean := false;
  v_activity_match boolean := false;
  v_has_schedule_scope boolean := false;
  v_schedule_match boolean := false;
  v_discipline_match boolean := false;
  v_intent_id uuid;
begin
  if target_studio_id is null
     or target_conversation_id is null
     or target_student_id is null
     or target_session_id is null
     or target_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id
    and studio_id=target_studio_id
    and active=true
    and lifecycle_status='active';

  if not found then
    return jsonb_build_object('ok',false,'reason_code','student_not_operable');
  end if;

  if not exists(
    select 1
    from public.assistant_conversations c
    where c.id=target_conversation_id
      and c.studio_id=target_studio_id
      and c.student_id=target_student_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=target_studio_id
    and status='scheduled';

  if not found then
    return jsonb_build_object('ok',false,'reason_code','session_not_available');
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id
    and studio_id=target_studio_id;

  if not found or v_template.discipline_id is null then
    return jsonb_build_object('ok',false,'reason_code','session_scope_unavailable');
  end if;

  select * into v_product
  from public.product_templates
  where id=target_product_template_id
    and studio_id=target_studio_id
    and active=true
    and assistant_visible is distinct from false
    and product_type <> 'enrollment';

  if not found then
    return jsonb_build_object('ok',false,'reason_code','product_not_available');
  end if;

  select exists(
    select 1 from public.product_template_activities pta
    where pta.studio_id=target_studio_id
      and pta.product_template_id=v_product.id
  ) into v_has_activity_scope;

  select exists(
    select 1 from public.product_template_activities pta
    where pta.studio_id=target_studio_id
      and pta.product_template_id=v_product.id
      and pta.class_template_id=v_template.id
  ) into v_activity_match;

  select exists(
    select 1 from public.product_template_disciplines ptd
    where ptd.studio_id=target_studio_id
      and ptd.product_template_id=v_product.id
      and ptd.discipline_id=v_template.discipline_id
  ) into v_discipline_match;

  if not (v_activity_match or (not v_has_activity_scope and v_discipline_match)) then
    return jsonb_build_object('ok',false,'reason_code','product_not_compatible');
  end if;

  select exists(
    select 1 from public.product_template_schedules pts
    where pts.studio_id=target_studio_id
      and pts.product_template_id=v_product.id
  ) into v_has_schedule_scope;

  select exists(
    select 1 from public.product_template_schedules pts
    where pts.studio_id=target_studio_id
      and pts.product_template_id=v_product.id
      and v_session.recurring_schedule_id is not null
      and pts.recurring_schedule_id=v_session.recurring_schedule_id
  ) into v_schedule_match;

  if v_has_schedule_scope and not v_schedule_match then
    return jsonb_build_object('ok',false,'reason_code','product_not_compatible');
  end if;

  if not exists(
    select 1
    from public.studio_payment_methods spm
    where spm.studio_id=target_studio_id
      and spm.active=true
      and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank
  from public.studio_bank_transfer_settings
  where studio_id=target_studio_id
    and enabled=true;

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

  update public.assistant_transfer_purchase_intents
  set status='cancelled',updated_at=clock_timestamp()
  where studio_id=target_studio_id
    and conversation_id=target_conversation_id
    and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,session_id,product_template_id,
    amount_minor,currency,status
  )
  values(
    target_studio_id,target_conversation_id,target_student_id,target_session_id,
    v_product.id,v_product.price_minor,v_product.currency,'awaiting_receipt'
  )
  returning id into v_intent_id;

  return jsonb_build_object(
    'ok',true,
    'status','awaiting_receipt',
    'intent_id',v_intent_id,
    'package',jsonb_build_object(
      'id',v_product.id,
      'name',v_product.name,
      'amount_minor',v_product.price_minor,
      'currency',v_product.currency
    ),
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,
      'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,
      'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,
      'instructions',v_bank.instructions
    ),
    'receipt_required',true,
    'activation_rule','activate_on_receipt_pending_validation',
    'revocable_until_validated',true
  );
end;
$function$;

revoke all on function public.service_prepare_transfer_purchase(uuid,uuid,uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.service_prepare_transfer_purchase(uuid,uuid,uuid,uuid,uuid)
to service_role;


create or replace function public.service_activate_transfer_receipt(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_event_id uuid,
  target_provider_message_id text,
  target_media_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent public.assistant_transfer_purchase_intents%rowtype;
  v_student public.students%rowtype;
  v_product public.product_templates%rowtype;
  v_studio_timezone text;
  v_sale_date date;
  v_sale_id uuid;
  v_sale_line_id uuid;
  v_acquisition_id uuid;
  v_folio text;
begin
  if target_studio_id is null
     or target_conversation_id is null
     or target_student_id is null
     or target_event_id is null
     or nullif(trim(coalesce(target_provider_message_id,'')),'') is null
     or nullif(trim(coalesce(target_media_id,'')),'') is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select * into v_intent
  from public.assistant_transfer_purchase_intents
  where studio_id=target_studio_id
    and conversation_id=target_conversation_id
    and student_id=target_student_id
    and status in ('awaiting_receipt','provisional_active')
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','pending_transfer_not_found');
  end if;

  if v_intent.status='provisional_active' then
    if v_intent.receipt_provider_message_id=target_provider_message_id then
      return jsonb_build_object(
        'ok',true,
        'status','provisional_active',
        'intent_id',v_intent.id,
        'sale_id',v_intent.sale_id,
        'acquisition_id',v_intent.acquisition_id,
        'idempotent',true,
        'revocable_until_validated',true
      );
    end if;
    return jsonb_build_object('ok',false,'reason_code','transfer_already_has_receipt');
  end if;

  if v_intent.expires_at <= clock_timestamp() then
    update public.assistant_transfer_purchase_intents
    set status='expired',updated_at=clock_timestamp()
    where id=v_intent.id;
    return jsonb_build_object('ok',false,'reason_code','transfer_intent_expired');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id
    and studio_id=target_studio_id
    and active=true
    and lifecycle_status='active'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','student_not_operable');
  end if;

  select * into v_product
  from public.product_templates
  where id=v_intent.product_template_id
    and studio_id=target_studio_id
    and active=true
    and product_type <> 'enrollment';

  if not found or v_product.validity_days is null then
    return jsonb_build_object('ok',false,'reason_code','product_not_available');
  end if;

  select timezone into v_studio_timezone
  from public.studios
  where id=target_studio_id;

  v_sale_date := (clock_timestamp() at time zone coalesce(v_studio_timezone,'America/Mexico_City'))::date;

  select id into v_sale_id
  from public.sales
  where studio_id=target_studio_id
    and idempotency_key=v_intent.id;

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
      v_product.currency,v_product.price_minor,null,v_intent.id,v_sale_date,
      'Comprobante de transferencia recibido; pago pendiente de validación.',
      true,null,'Paquete activado provisionalmente por comprobante de transferencia.'
    );

    insert into public.sale_lines(
      studio_id,sale_id,product_template_id,product_name,quantity,
      unit_price_minor,line_total_minor
    ) values(
      target_studio_id,v_sale_id,v_product.id,v_product.name,1,
      v_product.price_minor,v_product.price_minor
    )
    returning id into v_sale_line_id;

    insert into public.product_acquisitions(
      studio_id,student_id,product_template_id,status,starts_on,expires_on,
      credit_limit,unlimited,sale_line_id,validity_days_snapshot
    ) values(
      target_studio_id,target_student_id,v_product.id,'active',
      v_sale_date,v_sale_date+v_product.validity_days,
      v_product.credit_limit,v_product.unlimited,v_sale_line_id,v_product.validity_days
    )
    returning id into v_acquisition_id;

    if not v_product.unlimited and coalesce(v_product.credit_limit,0)>0 then
      insert into public.credit_ledger(
        studio_id,acquisition_id,movement_type,quantity,note,created_by
      ) values(
        target_studio_id,v_acquisition_id,'grant',v_product.credit_limit,
        'Activación provisional por comprobante de transferencia',null
      );
    end if;
  else
    select sl.id,pa.id
    into v_sale_line_id,v_acquisition_id
    from public.sale_lines sl
    join public.product_acquisitions pa on pa.sale_line_id=sl.id
    where sl.sale_id=v_sale_id
      and sl.product_template_id=v_product.id
    limit 1;
  end if;

  update public.assistant_transfer_purchase_intents
  set status='provisional_active',
      receipt_event_id=target_event_id,
      receipt_provider_message_id=target_provider_message_id,
      receipt_media_id=target_media_id,
      sale_id=v_sale_id,
      acquisition_id=v_acquisition_id,
      receipt_received_at=coalesce(receipt_received_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where id=v_intent.id;

  return jsonb_build_object(
    'ok',true,
    'status','provisional_active',
    'intent_id',v_intent.id,
    'sale_id',v_sale_id,
    'acquisition_id',v_acquisition_id,
    'package_name',v_product.name,
    'amount_minor',v_product.price_minor,
    'currency',v_product.currency,
    'revocable_until_validated',true,
    'payment_validation_required',true
  );
end;
$function$;

revoke all on function public.service_activate_transfer_receipt(uuid,uuid,uuid,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.service_activate_transfer_receipt(uuid,uuid,uuid,uuid,text,text)
to service_role;


create or replace function public.admin_review_transfer_purchase(
  target_intent_id uuid,
  target_decision text,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent public.assistant_transfer_purchase_intents%rowtype;
  v_sale public.sales%rowtype;
  v_decision text := lower(trim(coalesce(target_decision,'')));
  v_actor uuid := (select auth.uid());
  v_studio_timezone text;
  v_effective_on date;
  v_cancelled_reservations integer := 0;
begin
  if v_actor is null then raise exception 'unauthenticated'; end if;
  if v_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;

  select * into v_intent
  from public.assistant_transfer_purchase_intents
  where id=target_intent_id
  for update;

  if not found then raise exception 'transfer_intent_not_found'; end if;
  if not private.has_capability(v_intent.studio_id,'sales.write') then
    raise exception 'forbidden';
  end if;

  if v_intent.status='validated' and v_decision='approved' then
    return jsonb_build_object('ok',true,'status','validated','idempotent',true);
  end if;
  if v_intent.status='rejected' and v_decision='rejected' then
    return jsonb_build_object('ok',true,'status','rejected','idempotent',true);
  end if;
  if v_intent.status <> 'provisional_active' then
    raise exception 'transfer_not_reviewable';
  end if;

  select * into v_sale
  from public.sales
  where id=v_intent.sale_id
    and studio_id=v_intent.studio_id
  for update;

  if not found then raise exception 'sale_not_found'; end if;

  select timezone into v_studio_timezone
  from public.studios
  where id=v_intent.studio_id;
  v_effective_on := (clock_timestamp() at time zone coalesce(v_studio_timezone,'America/Mexico_City'))::date;

  if v_decision='approved' then
    if not exists(
      select 1 from public.payments p
      where p.sale_id=v_sale.id
        and p.kind='payment'
        and p.method='bank_transfer'
    ) then
      insert into public.payments(
        studio_id,sale_id,kind,amount_minor,method,reference,notes,
        created_by,effective_on
      ) values(
        v_intent.studio_id,v_sale.id,'payment',v_intent.amount_minor,
        'bank_transfer',v_intent.receipt_provider_message_id,
        'Transferencia validada desde revisión de comprobante de Demi.',
        v_actor,v_effective_on
      );
    end if;

    update public.sales
    set payment_due_on=null,
        collection_note='Transferencia validada.',
        pending_access_exception=false,
        pending_access_exception_by=null,
        pending_access_exception_reason=null,
        updated_at=clock_timestamp()
    where id=v_sale.id;

    update public.assistant_transfer_purchase_intents
    set status='validated',
        validated_at=clock_timestamp(),
        reviewed_by=v_actor,
        review_note=nullif(trim(coalesce(target_note,'')),''),
        updated_at=clock_timestamp()
    where id=v_intent.id;

    return jsonb_build_object(
      'ok',true,'status','validated','sale_id',v_sale.id,
      'acquisition_id',v_intent.acquisition_id
    );
  end if;

  update public.reservations r
  set status='cancelled_by_studio',
      cancelled_at=clock_timestamp(),
      cancellation_reason='Paquete provisional revocado: transferencia no validada.',
      cancelled_by=v_actor,
      updated_at=clock_timestamp()
  from public.class_sessions cs
  where r.acquisition_id=v_intent.acquisition_id
    and r.session_id=cs.id
    and r.status='reserved'
    and cs.starts_at>clock_timestamp();

  get diagnostics v_cancelled_reservations = row_count;

  update public.product_acquisitions
  set status='cancelled',
      updated_at=clock_timestamp()
  where id=v_intent.acquisition_id
    and status='active';

  update public.sales
  set status='voided',
      void_reason='Transferencia no validada',
      voided_at=clock_timestamp(),
      voided_by=v_actor,
      pending_access_exception=false,
      pending_access_exception_by=null,
      pending_access_exception_reason=null,
      collection_note='Transferencia rechazada; paquete provisional revocado.',
      updated_at=clock_timestamp()
  where id=v_sale.id
    and status='confirmed';

  update public.assistant_transfer_purchase_intents
  set status='rejected',
      rejected_at=clock_timestamp(),
      reviewed_by=v_actor,
      review_note=nullif(trim(coalesce(target_note,'')),''),
      updated_at=clock_timestamp()
  where id=v_intent.id;

  return jsonb_build_object(
    'ok',true,
    'status','rejected',
    'sale_id',v_sale.id,
    'acquisition_id',v_intent.acquisition_id,
    'future_reservations_cancelled',v_cancelled_reservations,
    'history_preserved',true
  );
end;
$function$;

revoke all on function public.admin_review_transfer_purchase(uuid,text,text)
from public, anon, service_role;
grant execute on function public.admin_review_transfer_purchase(uuid,text,text)
to authenticated;
