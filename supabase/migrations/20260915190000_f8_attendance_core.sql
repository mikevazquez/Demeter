-- F8 SF-073..082: attendance state, finalization, credit effects and auditable corrections.

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  from_status public.reservation_status not null,
  to_status public.reservation_status not null,
  reason text not null check (length(trim(reason)) > 0),
  corrected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_corrections_reservation_idx
  on public.attendance_corrections(reservation_id, created_at desc);

alter table public.attendance_corrections enable row level security;

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

  select * into v_session from public.class_sessions where id = v_reservation.session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then raise exception 'forbidden'; end if;
  if v_session.status = 'cancelled' then raise exception 'session_cancelled'; end if;
  if target_status not in ('attended','no_show') then raise exception 'invalid_attendance_status'; end if;

  v_old_status := v_reservation.status;
  if v_old_status in ('cancelled_on_time','cancelled_late','cancelled_by_studio') then
    raise exception 'cancelled_reservation';
  end if;

  if v_session.status = 'completed' then
    if nullif(trim(target_reason), '') is null then raise exception 'correction_reason_required'; end if;
    if v_old_status = target_status then return jsonb_build_object('ok', true, 'status', target_status::text, 'changed', false); end if;

    insert into public.attendance_corrections(studio_id, reservation_id, from_status, to_status, reason, corrected_by)
    values (v_reservation.studio_id, v_reservation.id, v_old_status, target_status, trim(target_reason), (select auth.uid()));
  end if;

  update public.reservations
  set status = target_status, updated_at = now()
  where id = v_reservation.id;

  return jsonb_build_object('ok', true, 'status', target_status::text, 'changed', v_old_status <> target_status);
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
  select * into v_session from public.class_sessions where id = target_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if not private.has_capability(v_session.studio_id, 'attendance.write') then raise exception 'forbidden'; end if;
  if v_session.status = 'cancelled' then raise exception 'session_cancelled'; end if;
  if v_session.status = 'completed' then return jsonb_build_object('ok', true, 'already_finalized', true); end if;

  -- A finalization is explicit: unresolved reserved spots become no-show.
  update public.reservations
  set status = 'no_show', updated_at = now()
  where session_id = target_session_id and status = 'reserved';

  for v_reservation in
    select r.id, r.studio_id, r.acquisition_id, r.status, r.credits_held, pa.unlimited
    from public.reservations r
    left join public.product_acquisitions pa on pa.id = r.acquisition_id
    where r.session_id = target_session_id and r.status in ('attended','no_show')
    for update of r
  loop
    v_credit_cost := greatest(coalesce(v_reservation.credits_held, 1), 1);
    if v_reservation.status = 'attended' then v_attended := v_attended + 1; else v_no_show := v_no_show + 1; end if;

    if v_reservation.acquisition_id is not null and not coalesce(v_reservation.unlimited, false) then
      insert into public.credit_ledger(studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by)
      values (
        v_reservation.studio_id, v_reservation.acquisition_id, 'consume', -v_credit_cost,
        v_reservation.id,
        case when v_reservation.status = 'attended'
          then format('%s crédito(s) consumidos por asistencia', v_credit_cost)
          else format('%s crédito(s) consumidos por no-show', v_credit_cost)
        end,
        (select auth.uid())
      ) on conflict (reservation_id, movement_type) do nothing;
    end if;
  end loop;

  update public.class_sessions set status = 'completed' where id = target_session_id;

  return jsonb_build_object('ok', true, 'already_finalized', false, 'attended', v_attended, 'no_show', v_no_show);
end;
$$;

revoke all on function public.set_attendance_status(uuid, public.reservation_status, text) from public, anon;
revoke all on function public.finalize_attendance(uuid) from public, anon;
grant execute on function public.set_attendance_status(uuid, public.reservation_status, text) to authenticated;
grant execute on function public.finalize_attendance(uuid) to authenticated;
