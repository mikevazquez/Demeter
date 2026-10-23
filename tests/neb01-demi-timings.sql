-- NEB-01-37 · Demi reminder timings (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
grant all on results to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg;
end $$;
grant execute on function pg_temp.err(text) to authenticated;
create function pg_temp.def() returns text language sql as $$
  select pg_get_functiondef('public.service_schedule_demi_followups(uuid,uuid,text,text,timestamp with time zone)'::regprocedure) $$;

insert into public.studios (id, name, slug) values ('ac000000-0000-0000-0000-0000000000ac', 'Estudio Demi', 'demi');
insert into public.studio_memberships values
  ('ac000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('ac000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-0000000000c1', 'coach', true);

-- 1 · the scheduler no longer has fixed timings.
insert into results select 1, 'sin tiempos fijos',
  position('interval ''2 hours''' in pg_temp.def()) = 0
  and position('interval ''15 days''' in pg_temp.def()) = 0
  and position('interval ''14 days''' in pg_temp.def()) = 0
  and position('interval ''-3 days''' in pg_temp.def()) = 0
  and position('settings.payment_reminder_hours' in pg_temp.def()) > 0;

-- 2 · defaults are Demeter's values.
insert into public.demi_followup_settings (studio_id) values ('ac000000-0000-0000-0000-0000000000ac');
insert into results select 2, 'valores de arranque',
  payment_reminder_hours = '{2,6}' and package_reminder_days = '{7,15,30}' and inactive_reminder_days = 14
  and package_expiring_days_before = 3 and trial_payment_hold_minutes = 30
  from public.demi_followup_settings where studio_id = 'ac000000-0000-0000-0000-0000000000ac';

-- 3 · the owner changes them (sorted); out-of-range values rejected; coach forbidden.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.admin_save_demi_reminder_timings('ac000000-0000-0000-0000-0000000000ac', '{12,3}', '{20,5}', 21, 2, 60);
insert into results select 3, 'el dueño los cambia',
  pg_temp.err($q$select public.admin_save_demi_reminder_timings('ac000000-0000-0000-0000-0000000000ac', '{1,2,3,4}', '{5}', 21, 2, 60)$q$) like '%violates check constraint%';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
update results set ok = ok and pg_temp.err($q$select public.admin_save_demi_reminder_timings('ac000000-0000-0000-0000-0000000000ac', '{1}', '{5}', 21, 2, 60)$q$) = 'forbidden' where n = 3;
reset role;
update results set ok = ok and (select payment_reminder_hours = '{3,12}' and package_reminder_days = '{5,20}'
  and inactive_reminder_days = 21 and trial_payment_hold_minutes = 60
  from public.demi_followup_settings where studio_id = 'ac000000-0000-0000-0000-0000000000ac') where n = 3;

-- 4 · the configured arrays become the same intervals the scheduler used.
insert into results select 4, 'arreglos a intervalos',
  (select array_agg(make_interval(hours=>u.h) order by u.o) from unnest(payment_reminder_hours) with ordinality u(h,o))
    = array[interval '3 hours', interval '12 hours']
  from public.demi_followup_settings where studio_id = 'ac000000-0000-0000-0000-0000000000ac';

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 4 then 'NEB01 DEMI TIMINGS OK ' || count(*) else 'NEB01 DEMI TIMINGS FAIL' end from results;
rollback;
