-- KIOSCO-01 · T07
-- Cierre automático e idempotente de sesiones al alcanzar ends_at.
-- Reutiliza exactamente la semántica actual de F8: pendientes -> no_show,
-- cierre de holds, consumo final de créditos y activación por primer uso.

create index if not exists class_sessions_due_attendance_idx
  on public.class_sessions(ends_at, id)
  where status = 'scheduled';

create or replace function private.finalize_attendance_core(
  target_session_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
  v_reservation record;
  v_credit_cost integer;
  v_attended integer := 0;
  v_no_show integer := 0;
begin
  -- El orden de locks coincide con check_in_reservation: sesión -> reservas.
  select * into v_session
  from public.class_sessions
  where id = target_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  if v_session.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'session_id', v_session.id
    );
  end if;

  if now() < v_session.ends_at then
    raise exception 'session_not_ended';
  end if;

  update public.reservations
  set status = 'no_show',
      updated_at = clock_timestamp()
  where session_id = target_session_id
    and status = 'reserved';

  for v_reservation in
    select
      r.id,
      r.studio_id,
      r.acquisition_id,
      r.status,
      r.credits_held,
      pa.unlimited
    from public.reservations r
    left join public.product_acquisitions pa
      on pa.id = r.acquisition_id
    where r.session_id = target_session_id
      and r.status in ('attended', 'no_show')
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
          format(
            'Cierre automático del hold de %s crédito(s) al finalizar asistencia',
            v_credit_cost
          ),
          p_actor_user_id
        )
        on conflict (reservation_id, movement_type) do nothing;
      end if;

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
        case
          when v_reservation.status = 'attended'
            then format('%s crédito(s) consumidos por asistencia', v_credit_cost)
          else format('%s crédito(s) consumidos por no-show', v_credit_cost)
        end,
        p_actor_user_id
      )
      on conflict (reservation_id, movement_type) do nothing;
    end if;

    if v_reservation.acquisition_id is not null then
      perform private.activate_acquisition_on_first_usage(
        v_reservation.acquisition_id,
        v_reservation.id
      );
    end if;
  end loop;

  update public.class_sessions
  set status = 'completed'
  where id = target_session_id
    and status = 'scheduled';

  return jsonb_build_object(
    'ok', true,
    'already_finalized', false,
    'session_id', v_session.id,
    'attended', v_attended,
    'no_show', v_no_show
  );
end;
$function$;

revoke all on function private.finalize_attendance_core(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.finalize_attendance(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.class_sessions%rowtype;
begin
  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'attendance.write')
     or not private.can_manage_attendance_session(v_session.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  return private.finalize_attendance_core(
    target_session_id,
    (select auth.uid())
  );
end;
$function$;

revoke all on function public.finalize_attendance(uuid)
from public, anon;
grant execute on function public.finalize_attendance(uuid)
to authenticated;

create or replace function private.finalize_due_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session record;
  v_result jsonb;
  v_processed integer := 0;
  v_already_finalized integer := 0;
  v_failed integer := 0;
begin
  for v_session in
    select cs.id
    from public.class_sessions cs
    where cs.status = 'scheduled'
      and cs.ends_at <= now()
    order by cs.ends_at, cs.id
    limit 500
  loop
    begin
      v_result := private.finalize_attendance_core(v_session.id, null);

      if coalesce((v_result->>'already_finalized')::boolean, false) then
        v_already_finalized := v_already_finalized + 1;
      else
        v_processed := v_processed + 1;
      end if;
    exception when others then
      -- Una sesión defectuosa no debe impedir el cierre de las demás.
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'already_finalized', v_already_finalized,
    'failed', v_failed
  );
end;
$function$;

revoke all on function private.finalize_due_sessions()
from public, anon, authenticated, service_role;

-- Un solo job canónico. pg_cron ejecuta con el rol de base de datos y no
-- depende de una sesión autenticada de Coach/Admin.
do $block$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'studio-flow-finalize-due-sessions'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'studio-flow-finalize-due-sessions',
    '* * * * *',
    'select private.finalize_due_sessions();'
  );
end;
$block$;
