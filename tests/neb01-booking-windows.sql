-- NEB-01-38/39/40 · booking windows, cancellation per activity and check-in (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
grant all on results to authenticated;
grant select, insert on public.reservations to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg;
end $$;
grant execute on function pg_temp.err(text) to authenticated;

-- Studio in Cancún (UTC-5), owner b1, student d1. Activity with its own rules.
insert into public.studios (id, name, slug, timezone) values ('a0000000-0000-0000-0000-00000000000a', 'Estudio Ventanas', 'ventanas', 'America/Cancun');
insert into public.studio_memberships values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'coach', true);
insert into public.students (id, studio_id, user_id) values ('b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1');
insert into public.class_templates (id, studio_id, name) values
  ('c0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000a', 'Regular'),
  ('c0000000-0000-0000-0000-0000000000cc', 'a0000000-0000-0000-0000-00000000000a', 'Taller');
insert into public.class_sessions (id, studio_id, template_id, starts_at) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c', now() + interval '10 minutes'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c', now() + interval '3 days'),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000cc', now() + interval '8 hours'),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c', timestamptz '2026-11-12 18:00:00-05');

-- 1 · defaults without a policy row: cancel 5 h, close 30 min, open none, QR 20/30.
insert into results select 1, 'valores de arranque',
  (r ->> 'cancellation_cutoff_minutes')::int = 300 and (r ->> 'booking_close_minutes_before')::int = 30
  and r ->> 'booking_open_mode' = 'none' and r -> 'booking_opens_at' = 'null'::jsonb
  and (r ->> 'checkin_opens_at')::timestamptz = (r ->> 'starts_at')::timestamptz - interval '20 minutes'
  and (r ->> 'checkin_closes_at')::timestamptz = (r ->> 'starts_at')::timestamptz + interval '30 minutes'
  from (select private.session_booking_rules('d0000000-0000-0000-0000-000000000002') r) x;

-- 2 · student cannot book a class closing in 10 minutes; Demi (no user) neither.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 2, 'alumna no reserva ya cerrada',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b')$q$) = 'booking_closed';
-- 3 · staff (owner) can still book it.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 3, 'recepción salta el cierre',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b')$q$) = 'ok';
reset role;
set local request.jwt.claim.sub = '';
insert into results select 4, 'Demi no reserva ya cerrada',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', null)$q$) = 'booking_closed';

-- 5 · studio sets relative opening of 2 days and closing of 60 min.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.owner_update_studio_booking_windows('a0000000-0000-0000-0000-00000000000a', 60, 'relative', 2880, null, null, 15, 45);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 5, 'apertura relativa: aún no abre',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b')$q$) = 'booking_not_open'
  and (public.booking_eligibility('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b') ->> 'reason_code') = 'booking_not_open'
  and (public.booking_eligibility('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b') ->> 'booking_opens_at') is not null;
-- 6 · the 8-hour class is open (inside 2 days, more than 60 min away).
insert into results select 6, 'dentro de la ventana sí reserva',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b')$q$) = 'ok';
reset role;

-- 7 · weekly opening: Sunday 20:00 opens the following Mon–Sun (Cancún time).
update public.studio_operating_policies set booking_open_mode = 'weekly', booking_open_minutes_before = null,
  booking_open_weekday = 0, booking_open_time = time '20:00' where studio_id = 'a0000000-0000-0000-0000-00000000000a';
insert into results select 7, 'apertura semanal: domingo 20:00 previo',
  (private.session_booking_rules('d0000000-0000-0000-0000-000000000004') ->> 'booking_opens_at')::timestamptz
    = timestamptz '2026-11-08 20:00:00-05';

-- 8 · activity override: the workshop cancels 12 h before and closes 0 min before.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.admin_update_activity_booking_rules('c0000000-0000-0000-0000-0000000000cc', 720, 0, 'none', null, null, null, null, null);
reset role;
insert into results select 8, 'regla propia de la actividad',
  (r ->> 'cancellation_cutoff_minutes')::int = 720 and (r ->> 'booking_close_minutes_before')::int = 0
  and r ->> 'booking_open_mode' = 'none' and (r ->> 'checkin_opens_at')::timestamptz = (r ->> 'starts_at')::timestamptz - interval '15 minutes'
  from (select private.session_booking_rules('d0000000-0000-0000-0000-000000000003') r) x;

-- 9 · cancellation per activity: 8 h away is late for the 12 h workshop, on time with 5 h.
insert into results select 9, 'cancelación según actividad',
  private.reservation_cancellation_outcome_for_session('d0000000-0000-0000-0000-000000000003') = 'cancelled_late'
  and private.reservation_cancellation_outcome_for_session('d0000000-0000-0000-0000-000000000002') = 'cancelled_on_time';

-- 10 · patched cancel_reservation uses the activity rule (stub returned cancelled_late always).
update public.class_templates set cancellation_cutoff_minutes = 60 where id = 'c0000000-0000-0000-0000-0000000000cc';
insert into results select 10, 'cancelar usa la regla nueva',
  public.cancel_reservation((select id from public.reservations where session_id = 'd0000000-0000-0000-0000-000000000003' limit 1)) = 'cancelled_on_time'
  and position('reservation_cancellation_outcome_for_session(v_session.id)' in pg_get_functiondef('public.cancel_reservation(uuid,text)'::regprocedure)) > 0;

-- 11 · patched QR check-in uses the configured window (15 before / 45 after).
insert into results select 11, 'QR con la ventana configurada',
  position('private.session_checkin_opens_at(v_session.id)' in pg_get_functiondef('public.check_in_reservation(text)'::regprocedure)) > 0
  and position('private.session_checkin_closes_at(v_session.id)' in pg_get_functiondef('public.check_in_reservation(text)'::regprocedure)) > 0
  and public.check_in_reservation('d0000000-0000-0000-0000-000000000002') ->> 'status' = 'too_early'
  and (public.check_in_reservation('d0000000-0000-0000-0000-000000000002') ->> 'available_at')::timestamptz
    = (select starts_at - interval '15 minutes' from public.class_sessions where id = 'd0000000-0000-0000-0000-000000000002');

-- 12 · waitlist promotion is not blocked; invalid configs are rejected; coach cannot change rules.
insert into public.class_waitlist_entries (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b');
insert into results select 12, 'lista de espera, validación y permisos',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b')$q$) = 'ok'
  and pg_temp.err($q$update public.studio_operating_policies set booking_open_mode = 'weekly', booking_open_weekday = null where studio_id = 'a0000000-0000-0000-0000-00000000000a'$q$) like '%violates check constraint%';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
update results set ok = ok and pg_temp.err($q$select public.admin_update_activity_booking_rules('c0000000-0000-0000-0000-0000000000cc', 1, 1, null, null, null, null, null, null)$q$) = 'forbidden'
  and pg_temp.err($q$select public.owner_update_studio_booking_windows('a0000000-0000-0000-0000-00000000000a', 1, 'none', null, null, null, 1, 1)$q$) = 'forbidden'
  where n = 12;
reset role;

-- 13 · the student sees windows for her studio only; anon gets nothing.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 13, 'ventanas visibles para la alumna',
  jsonb_array_length(public.session_booking_windows(array['d0000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid])) = 1;
reset role;
update results set ok = ok and not has_function_privilege('anon', 'public.session_booking_windows(uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'public.service_session_booking_windows(uuid,uuid[])', 'execute') where n = 13;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 13 then 'NEB01 BOOKING WINDOWS OK ' || count(*) else 'NEB01 BOOKING WINDOWS FAIL' end from results;
rollback;
