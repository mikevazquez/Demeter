-- F7 correctness: snapshot the credit cost held when a reservation is created.
-- Existing applied migrations are intentionally left untouched.

alter table public.reservations
  add column if not exists credits_held integer;

alter table public.reservations
  drop constraint if exists reservations_credits_held_check;

alter table public.reservations
  add constraint reservations_credits_held_check
  check (credits_held is null or credits_held >= 1);

-- Best-effort backfill. The ledger is authoritative when a reserve movement exists;
-- otherwise use the current template cost for legacy reservations.
update public.reservations r
set credits_held = coalesce(
  (
    select abs(cl.quantity)::integer
    from public.credit_ledger cl
    where cl.reservation_id = r.id
      and cl.movement_type = 'reserve'
    order by cl.created_at asc
    limit 1
  ),
  (
    select greatest(coalesce(ct.credit_cost, 1), 1)
    from public.class_sessions cs
    join public.class_templates ct on ct.id = cs.template_id
    where cs.id = r.session_id
  ),
  1
)
where r.credits_held is null;

alter table public.reservations
  alter column credits_held set default 1;

alter table public.reservations
  alter column credits_held set not null;

create or replace function public.book_student(target_session_id uuid, target_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_eligibility jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_reservation_id uuid;
  v_booked_count integer;
begin
  select * into v_session from public.class_sessions where id = target_session_id for update;
  if not found then raise exception 'session_not_found'; end if;

  select * into v_student from public.students where id = target_student_id and studio_id = v_session.studio_id;
  if not found then raise exception 'student_not_found'; end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write') and not (
    v_student.user_id = (select auth.uid())
    and private.has_capability(v_session.studio_id, 'student.booking.self')
  ) then
    raise exception 'forbidden';
  end if;

  v_eligibility := public.booking_eligibility(target_session_id, target_student_id);
  if not coalesce((v_eligibility->>'eligible')::boolean, false) then
    return v_eligibility;
  end if;

  v_acquisition_id := (v_eligibility->>'acquisition_id')::uuid;
  v_unlimited := coalesce((v_eligibility->>'unlimited')::boolean, false);
  v_credit_cost := greatest(coalesce((v_eligibility->>'credit_cost')::integer, 1), 1);

  perform 1 from public.product_acquisitions where id = v_acquisition_id for update;

  select count(*) into v_booked_count
  from public.reservations r
  where r.session_id = target_session_id and r.status in ('reserved','attended');
  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_full');
  end if;

  if exists (
    select 1 from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = target_student_id
      and r.status in ('reserved','attended')
  ) then
    return jsonb_build_object('eligible', false, 'reason_code', 'already_reserved');
  end if;

  if not v_unlimited and public.acquisition_credit_balance(v_acquisition_id) < v_credit_cost then
    return jsonb_build_object('eligible', false, 'reason_code', 'no_credits', 'credit_cost', v_credit_cost);
  end if;

  insert into public.reservations(
    studio_id, session_id, student_id, student_user_id, acquisition_id, status, credits_held
  ) values (
    v_session.studio_id, target_session_id, target_student_id, v_student.user_id,
    v_acquisition_id, 'reserved', v_credit_cost
  ) returning id into v_reservation_id;

  if not v_unlimited then
    insert into public.credit_ledger(
      studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
    ) values (
      v_session.studio_id, v_acquisition_id, 'reserve', -v_credit_cost, v_reservation_id,
      format('%s crédito(s) reservados al confirmar la clase', v_credit_cost), (select auth.uid())
    );
  end if;

  return jsonb_build_object(
    'eligible', true,
    'reason_code', null,
    'reservation_id', v_reservation_id,
    'acquisition_id', v_acquisition_id,
    'unlimited', v_unlimited,
    'credit_cost', v_credit_cost
  );
end;
$$;

create or replace function public.cancel_reservation(target_reservation_id uuid, target_reason text default null)
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
  v_cutoff timestamptz;
  v_new_status public.reservation_status;
  v_is_staff boolean;
begin
  select * into v_reservation from public.reservations where id = target_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  select * into v_session from public.class_sessions where id = v_reservation.session_id;
  select * into v_student from public.students where id = v_reservation.student_id;
  v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

  v_is_staff := private.has_capability(v_reservation.studio_id, 'schedule.write');
  if not v_is_staff and not (
    v_student.user_id = (select auth.uid())
    and private.has_capability(v_reservation.studio_id, 'student.booking.self')
  ) then
    raise exception 'forbidden';
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'reason_code', 'reservation_not_cancellable');
  end if;

  v_cutoff := v_session.starts_at - interval '8 hours';
  v_new_status := case when now() <= v_cutoff then 'cancelled_on_time' else 'cancelled_late' end;

  update public.reservations
  set status = v_new_status,
      cancelled_at = now(),
      cancellation_reason = nullif(trim(target_reason), ''),
      cancelled_by = (select auth.uid()),
      updated_at = now()
  where id = v_reservation.id;

  if v_reservation.acquisition_id is not null then
    select * into v_acquisition from public.product_acquisitions where id = v_reservation.acquisition_id for update;
    if found and not v_acquisition.unlimited then
      insert into public.credit_ledger(
        studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
      ) values (
        v_reservation.studio_id, v_reservation.acquisition_id, 'release', v_credit_cost,
        v_reservation.id,
        case when v_new_status = 'cancelled_on_time'
          then format('%s crédito(s) devueltos por cancelación a tiempo', v_credit_cost)
          else format('Cierre del hold de %s crédito(s) por cancelación tardía', v_credit_cost)
        end,
        (select auth.uid())
      ) on conflict (reservation_id, movement_type) do nothing;

      if v_new_status = 'cancelled_late' then
        insert into public.credit_ledger(
          studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
        ) values (
          v_reservation.studio_id, v_reservation.acquisition_id, 'consume', -v_credit_cost,
          v_reservation.id, format('%s crédito(s) consumidos por cancelación tardía', v_credit_cost),
          (select auth.uid())
        ) on conflict (reservation_id, movement_type) do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', v_new_status::text, 'credit_cost', v_credit_cost);
end;
$$;

create or replace function public.cancel_session_reservations(target_session_id uuid, target_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_reservation record;
  v_credit_cost integer;
  v_count integer := 0;
begin
  select * into v_session from public.class_sessions where id = target_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if not private.has_capability(v_session.studio_id, 'schedule.write') then raise exception 'forbidden'; end if;

  for v_reservation in
    select r.id, r.acquisition_id, r.credits_held, pa.unlimited
    from public.reservations r
    left join public.product_acquisitions pa on pa.id = r.acquisition_id
    where r.session_id = target_session_id and r.status = 'reserved'
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);

    update public.reservations
    set status = 'cancelled_by_studio',
        cancelled_at = now(),
        cancellation_reason = coalesce(nullif(trim(target_reason), ''), 'Clase cancelada por el estudio'),
        cancelled_by = (select auth.uid()),
        updated_at = now()
    where id = v_reservation.id;

    if v_reservation.acquisition_id is not null and not coalesce(v_reservation.unlimited, false) then
      insert into public.credit_ledger(
        studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
      ) values (
        v_session.studio_id, v_reservation.acquisition_id, 'release', v_credit_cost,
        v_reservation.id, format('%s crédito(s) devueltos por cancelación del estudio', v_credit_cost),
        (select auth.uid())
      ) on conflict (reservation_id, movement_type) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.book_student(uuid, uuid) from public, anon;
revoke all on function public.cancel_reservation(uuid, text) from public, anon;
revoke all on function public.cancel_session_reservations(uuid, text) from public, anon;
grant execute on function public.book_student(uuid, uuid) to authenticated;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;
grant execute on function public.cancel_session_reservations(uuid, text) to authenticated;
