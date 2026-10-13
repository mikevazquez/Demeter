create or replace function public.admin_schedule_prospect_trial(
  target_studio_id uuid,
  target_contact_id uuid,
  target_session_id uuid,
  target_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_studio_id uuid;
  v_contact public.crm_contacts%rowtype;
  v_method text := lower(trim(coalesce(target_payment_method, '')));
  v_preview jsonb;
  v_booking jsonb;
  v_reservation_id uuid;
begin
  v_studio_id := target_studio_id;
  if v_studio_id is null
     or not private.has_capability(v_studio_id, 'schedule.write')
     or not private.has_capability(v_studio_id, 'students.write') then
    raise exception 'forbidden';
  end if;
  if v_method not in ('cash', 'bank_transfer') then
    raise exception 'payment_method_required';
  end if;

  select * into v_contact
  from public.crm_contacts
  where id = target_contact_id and studio_id = v_studio_id
  for update;
  if not found or v_contact.lifecycle_status <> 'prospect' or v_contact.converted_student_id is not null then
    raise exception 'prospect_not_available';
  end if;

  v_preview := public.assistant_trial_booking_preview(v_studio_id, target_session_id, null, target_contact_id);
  if coalesce((v_preview->>'eligible')::boolean, false) is not true then
    raise exception '%', coalesce(v_preview->>'reason_code', 'trial_not_eligible');
  end if;

  v_booking := public.assistant_confirm_trial_booking(v_studio_id, target_session_id, null, target_contact_id, null);
  if coalesce((v_booking->>'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_booking->>'reason_code', 'trial_booking_failed');
  end if;
  v_reservation_id := nullif(v_booking->>'reservation_id', '')::uuid;

  update public.assistant_reservation_links
  set payment_preference = v_method,
      payment_preference_selected_at = now()
  where studio_id = v_studio_id and reservation_id = v_reservation_id;
  if not found then raise exception 'trial_payment_method_not_persisted'; end if;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'student_id', v_booking->>'student_id',
    'payment_method', v_method,
    'payment_status', 'payment_pending',
    'payment_review_required', v_method = 'bank_transfer'
  );
end;
$function$;

revoke all on function public.admin_schedule_prospect_trial(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.admin_schedule_prospect_trial(uuid, uuid, uuid, text) to authenticated;
