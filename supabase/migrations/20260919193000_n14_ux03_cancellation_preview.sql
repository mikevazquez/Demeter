-- SF-N14 · PORTAL UX-03 · cancellation preview
-- Keep the cancellation cutoff in one backend helper so UI never duplicates it.

create or replace function private.reservation_cancellation_outcome(target_starts_at timestamptz)
returns public.reservation_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when now() <= target_starts_at - interval '8 hours'
      then 'cancelled_on_time'::public.reservation_status
    else 'cancelled_late'::public.reservation_status
  end;
$$;

revoke all on function private.reservation_cancellation_outcome(timestamptz)
from public, anon, authenticated;

create or replace function public.cancel_reservation(
  target_reservation_id uuid,
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
  v_student public.students%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_credit_cost integer;
  v_new_status public.reservation_status;
  v_is_staff boolean;
begin
  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id;

  select *
    into v_student
  from public.students
  where id = v_reservation.student_id;

  v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

  v_is_staff := private.has_capability(v_reservation.studio_id, 'schedule.write');

  if not v_is_staff and not (
    v_student.user_id = (select auth.uid())
    and private.has_capability(v_reservation.studio_id, 'student.booking.self')
  ) then
    raise exception 'forbidden';
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_cancellable'
    );
  end if;

  v_new_status := private.reservation_cancellation_outcome(v_session.starts_at);

  update public.reservations
  set status = v_new_status,
      cancelled_at = now(),
      cancellation_reason = nullif(trim(target_reason), ''),
      cancelled_by = (select auth.uid()),
      updated_at = now()
  where id = v_reservation.id;

  if v_reservation.acquisition_id is not null then
    select *
      into v_acquisition
    from public.product_acquisitions
    where id = v_reservation.acquisition_id
    for update;

    if found and not v_acquisition.unlimited then
      insert into public.credit_ledger(
        studio_id,
        acquisition_id,
        movement_type,
        quantity,
        reservation_id,
        note,
        created_by
      )
      values (
        v_reservation.studio_id,
        v_reservation.acquisition_id,
        'release',
        v_credit_cost,
        v_reservation.id,
        case
          when v_new_status = 'cancelled_on_time'
            then format('%s crédito(s) devueltos por cancelación a tiempo', v_credit_cost)
          else format('Cierre del hold de %s crédito(s) por cancelación tardía', v_credit_cost)
        end,
        (select auth.uid())
      )
      on conflict (reservation_id, movement_type) do nothing;

      if v_new_status = 'cancelled_late' then
        insert into public.credit_ledger(
          studio_id,
          acquisition_id,
          movement_type,
          quantity,
          reservation_id,
          note,
          created_by
        )
        values (
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'consume',
          -v_credit_cost,
          v_reservation.id,
          format('%s crédito(s) consumidos por cancelación tardía', v_credit_cost),
          (select auth.uid())
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;
    end if;

    if v_new_status = 'cancelled_late' then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_new_status::text,
    'credit_cost', v_credit_cost
  );
end;
$$;

create or replace function public.student_cancellation_preview(
  target_reservation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_acquisition public.product_acquisitions%rowtype;
  v_outcome public.reservation_status;
  v_credit_cost integer;
  v_uses_credits boolean := false;
  v_unlimited boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if v_reservation.student_id is null
     or not private.is_current_student(
       v_reservation.student_id,
       v_reservation.studio_id
     ) then
    raise exception 'forbidden';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = v_reservation.session_id;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'reservation_not_cancellable'
    );
  end if;

  if v_reservation.acquisition_id is not null then
    select *
      into v_acquisition
    from public.product_acquisitions
    where id = v_reservation.acquisition_id;

    if found then
      v_unlimited := coalesce(v_acquisition.unlimited, false);
      v_uses_credits := not v_unlimited;
    end if;
  end if;

  v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
  v_outcome := private.reservation_cancellation_outcome(v_session.starts_at);

  return jsonb_build_object(
    'ok', true,
    'status', v_outcome::text,
    'late', v_outcome = 'cancelled_late',
    'uses_credits', v_uses_credits,
    'unlimited', v_unlimited,
    'credit_cost', v_credit_cost,
    'credit_will_return',
      case
        when not v_uses_credits then null
        else v_outcome = 'cancelled_on_time'
      end
  );
end;
$$;

revoke all on function public.student_cancellation_preview(uuid)
from public, anon;

grant execute on function public.student_cancellation_preview(uuid)
to authenticated;
