-- NEB-01-03 · guards on module entry points and on selling/booking (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.studios (id, name, slug) values ('30000000-0000-0000-0000-000000000003', 'Core Studio', 'core-studio');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin execute p_sql; return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce(':' || nullif(v_detail, ''), '');
end $$;

-- 1 · Demeter (All Access) can do everything.
insert into results select 1, 'all access usa todo', bool_and(r = 'ok') from (values
  (pg_temp.err($q$insert into public.sales (studio_id) values ('10000000-0000-0000-0000-000000000001')$q$)),
  (pg_temp.err($q$insert into public.reward_programs (studio_id) values ('10000000-0000-0000-0000-000000000001')$q$)),
  (pg_temp.err($q$insert into public.technical_evaluations (studio_id) values ('10000000-0000-0000-0000-000000000001')$q$)),
  (pg_temp.err($q$insert into public.space_maps (studio_id) values ('10000000-0000-0000-0000-000000000001')$q$))) v(r);

-- Mike moves the new studio to Core.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_studio_plan('30000000-0000-0000-0000-000000000003', 'core', 5::smallint);
reset role;

-- 2-4 · Core without modules is blocked per module, with the module in the detail.
insert into results select 2, 'core sin recompensas',
  pg_temp.err($q$insert into public.reward_programs (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'module_not_contracted:recompensas';
insert into results select 3, 'core sin catálogo',
  pg_temp.err($q$insert into public.evaluation_invitations (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'module_not_contracted:catalogo';
insert into results select 4, 'core sin recursos',
  pg_temp.err($q$insert into public.resources (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'module_not_contracted:recursos';

-- 5 · Core can still sell and book.
insert into results select 5, 'core vende y reserva',
  pg_temp.err($q$insert into public.sales (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'ok'
  and pg_temp.err($q$insert into public.reservations (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'ok';

-- 6 · buying the module unlocks it.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_studio_module('30000000-0000-0000-0000-000000000003', 'recompensas', true);
reset role;
insert into results select 6, 'módulo suelto desbloquea',
  pg_temp.err($q$insert into public.reward_challenge_enrollments (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'ok';

-- 7-8 · read only: no selling, no booking; grace still operates.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_studio_status('30000000-0000-0000-0000-000000000003', 'grace');
reset role;
insert into results select 7, 'en gracia sigue vendiendo',
  pg_temp.err($q$insert into public.sales (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'ok';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_studio_status('30000000-0000-0000-0000-000000000003', 'read_only');
reset role;
insert into results select 8, 'solo lectura no vende ni reserva',
  pg_temp.err($q$insert into public.sales (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'studio_read_only:sales'
  and pg_temp.err($q$insert into public.reservations (studio_id) values ('30000000-0000-0000-0000-000000000003')$q$) = 'studio_read_only:reservations';

-- 9 · the service entitlement reader is for service_role only.
insert into results select 9, 'lectura de servicio restringida',
  not has_function_privilege('authenticated', 'public.platform_studio_entitlements_service(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.platform_studio_entitlements_service(uuid)', 'execute');

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 9 then 'NEB01 GUARDS OK ' || count(*) else 'NEB01 GUARDS FAIL' end from results;
rollback;
