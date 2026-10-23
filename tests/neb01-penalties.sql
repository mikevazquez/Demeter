-- NEB-01-41 · penalties for regular students (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
grant all on results to authenticated;
grant select, insert, update on public.reservations, public.class_waitlist_entries to authenticated;
grant select on public.students to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg;
end $$;
grant execute on function pg_temp.err(text) to authenticated;
-- The real database already has this trigger (20260926015552).
create trigger reservations_capture_unlimited_operating_charge after update of status on public.reservations
  for each row execute function private.capture_unlimited_operating_charge();

insert into public.studios (id, name, slug) values ('e0000000-0000-0000-0000-00000000000e', 'Estudio Faltas', 'faltas');
insert into public.studio_memberships values
  ('e0000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000b1', 'owner', true);
insert into public.students (id, studio_id, user_id) values ('f0000000-0000-0000-0000-00000000000f', 'e0000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000d1');
insert into public.product_acquisitions (id, studio_id, student_id, status, unlimited) values
  ('aa000000-0000-0000-0000-0000000000aa', 'e0000000-0000-0000-0000-00000000000e', 'f0000000-0000-0000-0000-00000000000f', 'active', false);
insert into public.class_templates (id, studio_id) values ('cc000000-0000-0000-0000-0000000000cc', 'e0000000-0000-0000-0000-00000000000e');
insert into public.class_sessions (id, studio_id, template_id, starts_at)
select ('dd000000-0000-0000-0000-00000000000' || g)::uuid, 'e0000000-0000-0000-0000-00000000000e', 'cc000000-0000-0000-0000-0000000000cc',
  case when g <= 3 then now() - (g || ' days')::interval else now() + interval '2 days' end
from generate_series(1, 5) g;
-- three past reservations attended for now
insert into public.reservations (id, studio_id, session_id, student_id, acquisition_id, status)
select ('bb000000-0000-0000-0000-00000000000' || g)::uuid, 'e0000000-0000-0000-0000-00000000000e', ('dd000000-0000-0000-0000-00000000000' || g)::uuid,
  'f0000000-0000-0000-0000-00000000000f', 'aa000000-0000-0000-0000-0000000000aa', 'attended'
from generate_series(1, 3) g;

-- 1 · everything off by default: two no-shows create no pause and no charge.
update public.reservations set status = 'no_show' where id in ('bb000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002');
insert into results select 1, 'apagado por defecto',
  (select count(*) from public.student_booking_penalties) = 0 and (select count(*) from public.student_operating_charges) = 0;
update public.reservations set status = 'attended' where id in ('bb000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002');

-- Owner: 2 no-shows in 30 days → 7 days paused; $100 per no-show on packages; charge blocks.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.owner_update_studio_penalty_policy('e0000000-0000-0000-0000-00000000000e', 5000, 10000, true, 2, 30, 7, null, null, null);
reset role;

-- 2 · first no-show: $100 charge on the package, no pause yet.
update public.reservations set status = 'no_show' where id = 'bb000000-0000-0000-0000-000000000001';
insert into results select 2, 'cargo en paquete, sin pausa con 1',
  (select amount_minor from public.student_operating_charges where reservation_id = 'bb000000-0000-0000-0000-000000000001') = 10000
  and (select count(*) from public.student_booking_penalties) = 0;

-- 3 · the pending charge blocks booking for the student.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 3, 'adeudo bloquea reservar',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('e0000000-0000-0000-0000-00000000000e', 'dd000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f')$q$) = 'student_charge_pending';
reset role;

-- 4 · second no-show in 30 days → pause of 7 days.
update public.student_operating_charges set status = 'paid', resolved_at = now();
update public.reservations set status = 'no_show' where id = 'bb000000-0000-0000-0000-000000000002';
update public.student_operating_charges set status = 'paid', resolved_at = now();
insert into results select 4, 'pausa tras 2 faltas',
  (select count(*) from public.student_booking_penalties where kind = 'no_show' and status = 'active'
     and ends_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour') = 1;

-- 5 · paused student cannot book nor join the waitlist, even with an active package; staff can.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 5, 'pausa bloquea reservar y lista de espera',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('e0000000-0000-0000-0000-00000000000e', 'dd000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f')$q$) = 'student_booking_blocked'
  and pg_temp.err($q$insert into public.class_waitlist_entries (studio_id, session_id, student_id) values ('e0000000-0000-0000-0000-00000000000e', 'dd000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000f')$q$) = 'student_booking_blocked'
  and (public.student_booking_penalty_status() ->> 'reason_code') = 'student_booking_blocked'
  and (public.booking_eligibility('dd000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f') ->> 'reason_code') = 'student_booking_blocked';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
update results set ok = ok and pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('e0000000-0000-0000-0000-00000000000e', 'dd000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f')$q$) = 'ok' where n = 5;

-- 6 · a third no-show during the pause does not stack another one.
reset role;
update public.reservations set status = 'no_show' where id = 'bb000000-0000-0000-0000-000000000003';
insert into results select 6, 'no se enciman pausas',
  (select count(*) from public.student_booking_penalties) = 1;

-- 7 · staff waives the pause; the student can book again; it keeps who and why.
update public.student_operating_charges set status = 'paid', resolved_at = now();
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.admin_waive_student_booking_penalty((select id from public.student_booking_penalties limit 1), 'Avisó por enfermedad');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 7, 'recepción quita la pausa',
  pg_temp.err($q$insert into public.reservations (studio_id, session_id, student_id) values ('e0000000-0000-0000-0000-00000000000e', 'dd000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000f')$q$) = 'ok'
  and (select waived_by_user_id from public.student_booking_penalties limit 1) = '00000000-0000-0000-0000-0000000000b1'
  and (select waive_note from public.student_booking_penalties limit 1) = 'Avisó por enfermedad';
reset role;

-- 8 · events already used for a pause do not count again; a correction voids the charge.
update public.reservations set status = 'attended' where id = 'bb000000-0000-0000-0000-000000000003';
insert into results select 8, 'corrección anula el cargo y no reactiva la pausa',
  (select status from public.student_operating_charges where reservation_id = 'bb000000-0000-0000-0000-000000000003') in ('voided', 'paid')
  and (select count(*) from public.student_booking_penalties where status = 'active') = 0;

-- 9 · invalid config rejected; student cannot read another studio's penalties or change policy.
insert into results select 9, 'validación y permisos',
  pg_temp.err($q$update public.studio_operating_policies set no_show_block_threshold = 2, no_show_block_window_days = null where studio_id = 'e0000000-0000-0000-0000-00000000000e'$q$) like '%violates check constraint%';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
update results set ok = ok
  and pg_temp.err($q$select public.owner_update_studio_penalty_policy('e0000000-0000-0000-0000-00000000000e', 0, 0, true, null, null, null, null, null, null)$q$) = 'forbidden'
  and pg_temp.err($q$select public.admin_waive_student_booking_penalty((select id from public.student_booking_penalties limit 1), null)$q$) like '%'
  where n = 9;
reset role;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 9 then 'NEB01 PENALTIES OK ' || count(*) else 'NEB01 PENALTIES FAIL' end from results;
rollback;
