create or replace function public.service_waitlist_preview(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_booked integer;
  v_existing public.class_waitlist_entries%rowtype;
  v_eligibility jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null or target_session_id is null or target_student_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_found');
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'student_not_found');
  end if;

  if not private.studio_has_module(target_studio_id, 'waitlist') then
    return jsonb_build_object('ok', false, 'reason_code', 'module_not_enabled');
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = v_session.id
      and r.student_id = v_student.id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  select * into v_existing
  from public.class_waitlist_entries w
  where w.session_id = v_session.id
    and w.student_id = v_student.id
    and w.status = 'active'
  order by w.joined_at asc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'eligible', true,
      'reused', true,
      'waitlist_entry_id', v_existing.id,
      'reason_code', null
    );
  end if;

  select count(*)::integer into v_booked
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_booked < v_session.capacity then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'seat_available',
      'booked', v_booked,
      'capacity', v_session.capacity
    );
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);

  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','waitlist_not_eligible')
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'eligible', true,
    'reused', false,
    'reason_code', null,
    'booked', v_booked,
    'capacity', v_session.capacity,
    'credit_cost', v_eligibility->>'credit_cost',
    'unlimited', coalesce((v_eligibility->>'unlimited')::boolean,false),
    'available_credits', v_eligibility->'available_credits'
  );
end;
$function$;

create or replace function public.service_join_waitlist(
  target_studio_id uuid,
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_booked integer;
  v_existing public.class_waitlist_entries%rowtype;
  v_eligibility jsonb;
  v_entry public.class_waitlist_entries%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null or target_session_id is null or target_student_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id
    and studio_id = target_studio_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_found');
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = target_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'student_not_found');
  end if;

  if not private.studio_has_module(target_studio_id, 'waitlist') then
    return jsonb_build_object('ok', false, 'reason_code', 'module_not_enabled');
  end if;

  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = v_session.id
      and r.student_id = v_student.id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'already_reserved');
  end if;

  select * into v_existing
  from public.class_waitlist_entries w
  where w.session_id = v_session.id
    and w.student_id = v_student.id
    and w.status = 'active'
  order by w.joined_at asc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'waitlist_entry_id', v_existing.id,
      'status', 'active'
    );
  end if;

  select count(*)::integer into v_booked
  from public.reservations r
  where r.session_id = v_session.id
    and r.status in ('reserved','attended');

  if v_booked < v_session.capacity then
    return jsonb_build_object('ok', false, 'reason_code', 'seat_available');
  end if;

  v_eligibility := private.waitlist_eligibility_core(v_session.id, v_student.id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', coalesce(v_eligibility->>'reason_code','waitlist_not_eligible')
    );
  end if;

  insert into public.class_waitlist_entries(
    studio_id, session_id, student_id, status
  )
  values(
    target_studio_id, v_session.id, v_student.id, 'active'
  )
  returning * into v_entry;

  perform public.emit_domain_event(
    target_studio_id,
    'waitlist.joined',
    'waitlist_entry',
    v_entry.id,
    'waitlist.joined:' || v_entry.id::text,
    clock_timestamp(),
    null,
    jsonb_build_object(
      'waitlist_entry_id', v_entry.id,
      'session_id', v_session.id,
      'student_id', v_student.id,
      'source', 'assistant'
    ),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'waitlist_entry_id', v_entry.id,
    'status', 'active'
  );
end;
$function$;

revoke all on function public.service_waitlist_preview(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.service_join_waitlist(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.service_waitlist_preview(uuid,uuid,uuid) to service_role;
grant execute on function public.service_join_waitlist(uuid,uuid,uuid) to service_role;
