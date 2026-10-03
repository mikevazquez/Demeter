-- Demi WhatsApp resource-aware booking and reschedule bridges.
-- Restricted to service_role and reuses canonical booking/reschedule logic.

create or replace function public.service_book_student_with_resource(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid,
  target_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_setting public.session_resources%rowtype;
  v_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_booking jsonb;
  v_reservation_id uuid;
begin
  if target_studio_id is null
     or target_session_id is null
     or target_student_id is null
     or target_resource_id is null then
    return jsonb_build_object('eligible',false,'reason_code','invalid_input');
  end if;

  select *
    into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=target_studio_id
  for update;

  if not found then
    return jsonb_build_object('eligible',false,'reason_code','session_not_found');
  end if;

  if not v_session.requires_resource or v_session.space_id is null then
    return jsonb_build_object('eligible',false,'reason_code','resource_not_required');
  end if;

  select *
    into v_setting
  from public.session_resources
  where studio_id=target_studio_id
    and session_id=target_session_id
    and resource_id=target_resource_id
  for update;

  if not found or not v_setting.enabled then
    return jsonb_build_object('eligible',false,'reason_code','resource_not_available');
  end if;

  select *
    into v_resource
  from public.resources
  where id=target_resource_id
    and studio_id=target_studio_id
    and space_id=v_session.space_id;

  if not found or not v_resource.active then
    return jsonb_build_object('eligible',false,'reason_code','resource_not_available');
  end if;

  v_capacity := coalesce(v_setting.capacity_override,v_session.resource_uses_per_item,1);

  select count(*)::integer
    into v_used
  from public.reservation_resource_assignments a
  where a.studio_id=target_studio_id
    and a.session_id=target_session_id
    and a.resource_id=target_resource_id
    and a.released_at is null;

  if v_used >= v_capacity then
    return jsonb_build_object(
      'eligible',false,
      'reason_code','resource_full',
      'resource_id',target_resource_id
    );
  end if;

  v_booking := public.service_book_student(
    target_studio_id,
    target_session_id,
    target_student_id
  );

  if coalesce((v_booking->>'eligible')::boolean,false) is not true then
    return v_booking;
  end if;

  v_reservation_id := nullif(v_booking->>'reservation_id','')::uuid;
  if v_reservation_id is null then
    raise exception 'booking_missing_reservation';
  end if;

  insert into public.reservation_resource_assignments(
    studio_id,session_id,reservation_id,resource_id,assigned_by
  )
  values(
    target_studio_id,target_session_id,v_reservation_id,target_resource_id,null
  );

  return v_booking || jsonb_build_object(
    'resource_id',target_resource_id,
    'resource_name',v_resource.name
  );
end;
$function$;

revoke all on function public.service_book_student_with_resource(uuid,uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.service_book_student_with_resource(uuid,uuid,uuid,uuid)
to service_role;


create or replace function public.service_reschedule_student_reservation_with_resource(
  target_studio_id uuid,
  target_student_id uuid,
  target_reservation_id uuid,
  target_session_id uuid,
  target_resource_id uuid,
  target_reason text default 'Reagendado por Demi'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_setting public.session_resources%rowtype;
  v_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_result jsonb;
  v_new_reservation_id uuid;
begin
  if target_studio_id is null
     or target_student_id is null
     or target_reservation_id is null
     or target_session_id is null
     or target_resource_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select *
    into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=target_studio_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','target_session_not_found');
  end if;

  if not v_session.requires_resource or v_session.space_id is null then
    return jsonb_build_object('ok',false,'reason_code','resource_not_required');
  end if;

  select *
    into v_setting
  from public.session_resources
  where studio_id=target_studio_id
    and session_id=target_session_id
    and resource_id=target_resource_id
  for update;

  if not found or not v_setting.enabled then
    return jsonb_build_object('ok',false,'reason_code','resource_not_available');
  end if;

  select *
    into v_resource
  from public.resources
  where id=target_resource_id
    and studio_id=target_studio_id
    and space_id=v_session.space_id;

  if not found or not v_resource.active then
    return jsonb_build_object('ok',false,'reason_code','resource_not_available');
  end if;

  v_capacity := coalesce(v_setting.capacity_override,v_session.resource_uses_per_item,1);

  select count(*)::integer
    into v_used
  from public.reservation_resource_assignments a
  where a.studio_id=target_studio_id
    and a.session_id=target_session_id
    and a.resource_id=target_resource_id
    and a.released_at is null;

  if v_used >= v_capacity then
    return jsonb_build_object(
      'ok',false,
      'reason_code','resource_full',
      'resource_id',target_resource_id
    );
  end if;

  v_result := public.service_reschedule_student_reservation(
    target_studio_id,
    target_student_id,
    target_reservation_id,
    target_session_id,
    target_reason
  );

  if coalesce((v_result->>'ok')::boolean,false) is not true then
    return v_result;
  end if;

  v_new_reservation_id := nullif(v_result->>'target_reservation_id','')::uuid;
  if v_new_reservation_id is null then
    raise exception 'reschedule_missing_target_reservation';
  end if;

  insert into public.reservation_resource_assignments(
    studio_id,session_id,reservation_id,resource_id,assigned_by
  )
  values(
    target_studio_id,target_session_id,v_new_reservation_id,target_resource_id,null
  );

  return v_result || jsonb_build_object(
    'resource_id',target_resource_id,
    'resource_name',v_resource.name
  );
end;
$function$;

revoke all on function public.service_reschedule_student_reservation_with_resource(uuid,uuid,uuid,uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.service_reschedule_student_reservation_with_resource(uuid,uuid,uuid,uuid,uuid,text)
to service_role;


create or replace function public.service_confirm_trial_booking_with_resource(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid,
  target_crm_contact_id uuid,
  target_assistant_conversation_id uuid,
  target_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_setting public.session_resources%rowtype;
  v_resource public.resources%rowtype;
  v_capacity integer;
  v_used integer;
  v_booking jsonb;
  v_reservation_id uuid;
begin
  if target_studio_id is null
     or target_session_id is null
     or target_resource_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select *
    into v_session
  from public.class_sessions
  where id=target_session_id
    and studio_id=target_studio_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','session_not_found');
  end if;

  if not v_session.requires_resource or v_session.space_id is null then
    return jsonb_build_object('ok',false,'reason_code','resource_not_required');
  end if;

  select *
    into v_setting
  from public.session_resources
  where studio_id=target_studio_id
    and session_id=target_session_id
    and resource_id=target_resource_id
  for update;

  if not found or not v_setting.enabled then
    return jsonb_build_object('ok',false,'reason_code','resource_not_available');
  end if;

  select *
    into v_resource
  from public.resources
  where id=target_resource_id
    and studio_id=target_studio_id
    and space_id=v_session.space_id;

  if not found or not v_resource.active then
    return jsonb_build_object('ok',false,'reason_code','resource_not_available');
  end if;

  v_capacity := coalesce(v_setting.capacity_override,v_session.resource_uses_per_item,1);

  select count(*)::integer
    into v_used
  from public.reservation_resource_assignments a
  where a.studio_id=target_studio_id
    and a.session_id=target_session_id
    and a.resource_id=target_resource_id
    and a.released_at is null;

  if v_used >= v_capacity then
    return jsonb_build_object(
      'ok',false,
      'reason_code','resource_full',
      'resource_id',target_resource_id
    );
  end if;

  v_booking := public.assistant_confirm_trial_booking(
    target_studio_id,
    target_session_id,
    target_student_id,
    target_crm_contact_id,
    target_assistant_conversation_id
  );

  if coalesce((v_booking->>'ok')::boolean,false) is not true then
    return v_booking;
  end if;

  v_reservation_id := nullif(v_booking->>'reservation_id','')::uuid;
  if v_reservation_id is null then
    raise exception 'trial_booking_missing_reservation';
  end if;

  insert into public.reservation_resource_assignments(
    studio_id,session_id,reservation_id,resource_id,assigned_by
  )
  values(
    target_studio_id,target_session_id,v_reservation_id,target_resource_id,null
  );

  return v_booking || jsonb_build_object(
    'resource_id',target_resource_id,
    'resource_name',v_resource.name
  );
end;
$function$;

revoke all on function public.service_confirm_trial_booking_with_resource(uuid,uuid,uuid,uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.service_confirm_trial_booking_with_resource(uuid,uuid,uuid,uuid,uuid,uuid)
to service_role;
