-- KIOSCO-01 · T09 (parte 1)
-- La asistencia manual del Coach sólo existe mientras la sesión está en curso.
-- Después del cierre, sólo Owner/Admin puede corregir el historial con motivo auditable.

create or replace function public.set_attendance_status(
  target_reservation_id uuid,
  target_status public.reservation_status,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_old_status public.reservation_status;
  v_is_admin boolean;
begin
  select * into v_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  select * into v_session
  from public.class_sessions
  where id = v_reservation.session_id
    and studio_id = v_reservation.studio_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  v_is_admin := private.has_studio_role(
    v_reservation.studio_id,
    array['owner'::public.studio_role, 'admin'::public.studio_role]
  );

  if v_session.status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  if target_status not in ('attended', 'no_show') then
    raise exception 'invalid_attendance_status';
  end if;

  v_old_status := v_reservation.status;

  if v_old_status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio') then
    raise exception 'cancelled_reservation';
  end if;

  if v_session.status = 'completed' then
    if not v_is_admin then
      raise exception 'forbidden';
    end if;

    if nullif(trim(target_reason), '') is null then
      raise exception 'correction_reason_required';
    end if;

    if v_old_status not in ('attended', 'no_show') then
      raise exception 'invalid_completed_attendance_state';
    end if;

    if v_old_status = target_status then
      return jsonb_build_object(
        'ok', true,
        'status', target_status::text,
        'changed', false
      );
    end if;

    insert into public.attendance_corrections(
      studio_id,
      reservation_id,
      from_status,
      to_status,
      reason,
      corrected_by
    )
    values (
      v_reservation.studio_id,
      v_reservation.id,
      v_old_status,
      target_status,
      trim(target_reason),
      (select auth.uid())
    );
  else
    -- En sesión programada, Owner/Admin o el instructor asignado pueden operar,
    -- pero únicamente durante el intervalo real de la clase.
    if not private.can_manage_attendance_session(
      v_reservation.studio_id,
      v_session.id
    ) then
      raise exception 'forbidden';
    end if;

    if now() < v_session.starts_at then
      raise exception 'session_not_started';
    end if;

    if now() >= v_session.ends_at then
      raise exception 'session_ended';
    end if;

    if v_old_status not in ('reserved', 'attended', 'no_show') then
      raise exception 'invalid_attendance_state';
    end if;
  end if;

  update public.reservations
  set status = target_status,
      updated_at = clock_timestamp()
  where id = v_reservation.id;

  return jsonb_build_object(
    'ok', true,
    'status', target_status::text,
    'changed', v_old_status <> target_status
  );
end;
$function$;

revoke all on function public.set_attendance_status(
  uuid,
  public.reservation_status,
  text
) from public, anon;

grant execute on function public.set_attendance_status(
  uuid,
  public.reservation_status,
  text
) to authenticated;
