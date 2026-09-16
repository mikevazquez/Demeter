-- F11 · Coach: endurece mutaciones F8 para que un instructor sólo gestione sus sesiones asignadas.

create or replace function private.can_manage_attendance_session(
  target_studio_id uuid,
  target_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_studio_role(
      target_studio_id,
      array['owner'::public.studio_role, 'admin'::public.studio_role]
    )
    or private.is_current_instructor_session(target_studio_id, target_session_id);
$$;

revoke execute on function private.can_manage_attendance_session(uuid, uuid) from public, anon;
grant execute on function private.can_manage_attendance_session(uuid, uuid) to authenticated;

create or replace function public.set_attendance_status(
  target_reservation_id uuid,
  target_status public.reservation_status,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_old_status public.reservation_status;
begin
  select * into v_reservation
  from public.reservations
  where id = target_reservation_id
  for update;
  if not found then raise exception 'reservation_not_found'; end if;

  select * into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = v_reservation.studio_id
  for update;
  if not found then raise exception 'session_not_found'; end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_reservation.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  if v_session.status = 'cancelled' then raise exception 'session_cancelled'; end if;
  if target_status not in ('attended','no_show') then raise exception 'invalid_attendance_status'; end if;

  v_old_status := v_reservation.status;
  if v_old_status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
    raise exception 'cancelled_reservation';
  end if;

  if v_session.status = 'completed' then
    if nullif(trim(target_reason), '') is null then raise exception 'correction_reason_required'; end if;
    if v_old_status = target_status then
      return jsonb_build_object('ok', true, 'status', target_status::text, 'changed', false);
    end if;

    insert into public.attendance_corrections(
      studio_id, reservation_id, from_status, to_status, reason, corrected_by
    )
    values (
      v_reservation.studio_id, v_reservation.id, v_old_status, target_status,
      trim(target_reason), (select auth.uid())
    );
  end if;

  update public.reservations
  set status = target_status, updated_at = now()
  where id = v_reservation.id;

  return jsonb_build_object(
    'ok', true,
    'status', target_status::text,
    'changed', v_old_status <> target_status
  );
end;
$$;

create or replace function public.finalize_attendance(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_reservation record;
  v_credit_cost integer;
  v_attended integer := 0;
  v_no_show integer := 0;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;
  if not found then raise exception 'session_not_found'; end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  if v_session.status = 'cancelled' then raise exception 'session_cancelled'; end if;
  if v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'already_finalized', true);
  end if;

  update public.reservations
  set status = 'no_show', updated_at = now()
  where session_id = target_session_id and status = 'reserved';

  for v_reservation in
    select r.id, r.studio_id, r.acquisition_id, r.status, r.credits_held, pa.unlimited
    from public.reservations r
    left join public.product_acquisitions pa on pa.id = r.acquisition_id
    where r.session_id = target_session_id and r.status in ('attended', 'no_show')
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
    if v_reservation.status = 'attended' then
      v_attended := v_attended + 1;
    else
      v_no_show := v_no_show + 1;
    end if;

    if v_reservation.acquisition_id is not null
       and not coalesce(v_reservation.unlimited, false) then
      if exists (
        select 1
        from public.credit_ledger cl
        where cl.reservation_id = v_reservation.id
          and cl.movement_type = 'reserve'
      ) then
        insert into public.credit_ledger(
          studio_id, acquisition_id, movement_type, quantity,
          reservation_id, note, created_by
        )
        values (
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'release',
          v_credit_cost,
          v_reservation.id,
          format('Cierre del hold de %s crédito(s) al finalizar asistencia', v_credit_cost),
          (select auth.uid())
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;

      insert into public.credit_ledger(
        studio_id, acquisition_id, movement_type, quantity,
        reservation_id, note, created_by
      )
      values (
        v_reservation.studio_id,
        v_reservation.acquisition_id,
        'consume',
        -v_credit_cost,
        v_reservation.id,
        case
          when v_reservation.status = 'attended'
            then format('%s crédito(s) consumidos por asistencia', v_credit_cost)
          else format('%s crédito(s) consumidos por no-show', v_credit_cost)
        end,
        (select auth.uid())
      )
      on conflict (reservation_id, movement_type) do nothing;
    end if;
  end loop;

  update public.class_sessions
  set status = 'completed'
  where id = target_session_id;

  return jsonb_build_object(
    'ok', true,
    'already_finalized', false,
    'attended', v_attended,
    'no_show', v_no_show
  );
end;
$$;

create or replace function public.add_existing_walkin_student(
  target_session_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_reservation_id uuid;
  v_count integer;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  select * into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;
  if not found then raise exception 'student_not_found'; end if;
  if not v_student.active or v_student.lifecycle_status <> 'active' then
    raise exception 'student_not_operable';
  end if;

  if exists (
    select 1
    from public.reservations
    where session_id = target_session_id
      and student_id = target_student_id
      and status in ('reserved', 'attended', 'no_show')
  ) then
    raise exception 'already_in_roster';
  end if;

  select count(*) into v_count
  from public.reservations
  where session_id = target_session_id
    and status in ('reserved', 'attended');
  if v_count >= v_session.capacity then raise exception 'session_full'; end if;

  insert into public.reservations(studio_id, session_id, student_id, status, credits_held)
  values (v_session.studio_id, target_session_id, target_student_id, 'reserved', 1)
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'reservation_id', v_reservation_id,
    'walkin', true,
    'commercial_pending', true
  );
end;
$$;

create or replace function public.create_walkin_student(
  target_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_reservation_id uuid;
  v_full_name text;
  v_count integer;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_not_open'; end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  -- No se otorga students.write global al Coach. La excepción queda encerrada en
  -- este RPC y sólo para una sesión que realmente tiene asignada.
  if not private.has_capability(v_session.studio_id, 'students.write')
     and not private.is_current_instructor_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  if trim(coalesce(p_first_name, '')) = '' then raise exception 'first_name_required'; end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_invalid'; end if;
  if exists (
    select 1
    from public.person_contacts
    where studio_id = v_session.studio_id
      and kind = 'phone'
      and value = p_phone
  ) then
    raise exception 'phone_exists';
  end if;

  select count(*) into v_count
  from public.reservations
  where session_id = target_session_id
    and status in ('reserved', 'attended');
  if v_count >= v_session.capacity then raise exception 'session_full'; end if;

  insert into public.persons(studio_id, first_name, last_name)
  values (
    v_session.studio_id,
    trim(p_first_name),
    nullif(trim(coalesce(p_last_name, '')), '')
  )
  returning id into v_person_id;

  insert into public.person_contacts(person_id, studio_id, kind, value, is_primary)
  values (v_person_id, v_session.studio_id, 'phone', p_phone, true);

  v_full_name := trim(
    p_first_name ||
    case
      when nullif(trim(coalesce(p_last_name, '')), '') is not null
        then ' ' || trim(p_last_name)
      else ''
    end
  );

  insert into public.students(
    studio_id, person_id, full_name, phone, active, lifecycle_status, profile_status
  )
  values (
    v_session.studio_id, v_person_id, v_full_name, p_phone,
    true, 'active', 'incomplete'
  )
  returning id into v_student_id;

  update public.students
  set profile_status = private.student_profile_status(v_student_id), updated_at = now()
  where id = v_student_id;

  insert into public.reservations(studio_id, session_id, student_id, status, credits_held)
  values (v_session.studio_id, target_session_id, v_student_id, 'reserved', 1)
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', v_student_id,
    'reservation_id', v_reservation_id,
    'walkin', true
  );
end;
$$;

revoke all on function public.set_attendance_status(uuid, public.reservation_status, text) from public, anon;
revoke all on function public.finalize_attendance(uuid) from public, anon;
revoke all on function public.add_existing_walkin_student(uuid, uuid) from public, anon;
revoke all on function public.create_walkin_student(uuid, text, text, text) from public, anon;

grant execute on function public.set_attendance_status(uuid, public.reservation_status, text) to authenticated;
grant execute on function public.finalize_attendance(uuid) to authenticated;
grant execute on function public.add_existing_walkin_student(uuid, uuid) to authenticated;
grant execute on function public.create_walkin_student(uuid, text, text, text) to authenticated;
