-- F8 SF-080: convert a reservation hold into final consumption without double-debiting.
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
  if not private.has_capability(v_session.studio_id, 'attendance.write') then raise exception 'forbidden'; end if;
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

    if v_reservation.acquisition_id is not null and not coalesce(v_reservation.unlimited, false) then
      -- reserve is a hold that already reduced the available balance.
      if exists (
        select 1
        from public.credit_ledger cl
        where cl.reservation_id = v_reservation.id
          and cl.movement_type = 'reserve'
      ) then
        insert into public.credit_ledger(
          studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
        ) values (
          v_reservation.studio_id,
          v_reservation.acquisition_id,
          'release',
          v_credit_cost,
          v_reservation.id,
          format('Cierre del hold de %s crédito(s) al finalizar asistencia', v_credit_cost),
          (select auth.uid())
        ) on conflict (reservation_id, movement_type) do nothing;
      end if;

      insert into public.credit_ledger(
        studio_id, acquisition_id, movement_type, quantity, reservation_id, note, created_by
      ) values (
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
      ) on conflict (reservation_id, movement_type) do nothing;
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

revoke all on function public.finalize_attendance(uuid) from public, anon;
grant execute on function public.finalize_attendance(uuid) to authenticated;
