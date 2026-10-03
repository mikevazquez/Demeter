alter table public.assistant_reservation_links
  add column if not exists payment_preference text,
  add column if not exists payment_preference_selected_at timestamptz;

alter table public.assistant_reservation_links
  drop constraint if exists assistant_reservation_links_payment_preference_check;

alter table public.assistant_reservation_links
  add constraint assistant_reservation_links_payment_preference_check
  check (payment_preference is null or payment_preference in ('cash','bank_transfer'));

create or replace function public.assistant_record_trial_payment_preference(
  target_studio_id uuid,
  target_assistant_conversation_id uuid,
  target_payment_preference text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_link public.assistant_reservation_links%rowtype;
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_preference text;
begin
  v_preference := lower(trim(coalesce(target_payment_preference,'')));

  if v_preference not in ('cash','bank_transfer') then
    return jsonb_build_object('ok',false,'reason_code','payment_method_not_supported');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_link
  from public.assistant_reservation_links
  where studio_id=target_studio_id
    and assistant_conversation_id=target_assistant_conversation_id
    and source='assistant_trial'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','trial_reservation_not_found');
  end if;

  select * into v_reservation
  from public.reservations
  where id=v_link.reservation_id
    and studio_id=target_studio_id;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','reservation_not_found');
  end if;

  select * into v_session
  from public.class_sessions
  where id=v_reservation.session_id
    and studio_id=target_studio_id;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id
    and studio_id=target_studio_id;

  update public.assistant_reservation_links
  set payment_preference=v_preference,
      payment_preference_selected_at=now()
  where id=v_link.id;

  return jsonb_build_object(
    'ok',true,
    'reservation_id',v_reservation.id,
    'payment_preference',v_preference,
    'amount_minor',v_template.drop_in_price_minor,
    'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN')),
    'first_class_no_enrollment',true,
    'enrollment_required_after_first_attendance',true,
    'marks_payment_received',false,
    'transfer_details_configured',false
  );
end;
$function$;

revoke all on function public.assistant_record_trial_payment_preference(uuid,uuid,text) from public;
grant execute on function public.assistant_record_trial_payment_preference(uuid,uuid,text)
  to authenticated,service_role;

update public.class_templates
set drop_in_price_minor=15000
where studio_id='9fe23cfa-fb47-4670-afeb-ed4a56433772'
  and id='1075cb41-75e4-4190-81f6-4be0ed007ce6';
