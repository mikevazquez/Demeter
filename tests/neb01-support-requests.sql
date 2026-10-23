-- NEB-01-19 · solicitudes de soporte (local DB only).
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

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
insert into public.studios (id, name, slug, brand_name) values
  ('70000000-0000-0000-0000-000000000007', 'Estudio Ayuda', 'ayuda', 'Ayuda Studio'),
  ('71000000-0000-0000-0000-000000000007', 'Otro Estudio', 'otro', null);
insert into public.studio_memberships values
  ('70000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('70000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000c1', 'coach', true);

-- 1 · La dueña crea; asunto corto se rechaza; el coach (sin ajustes) no puede.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
create temp table created as select public.studio_create_support_request('70000000-0000-0000-0000-000000000007', '  No  puedo cambiar precios ', 'Me marca error') id;
insert into results select 1, 'dueña crea y valida asunto',
  pg_temp.err($$select public.studio_create_support_request('70000000-0000-0000-0000-000000000007', 'x', '')$$) = 'support_subject_invalid'
  and (select public.studio_support_requests('70000000-0000-0000-0000-000000000007') -> 0 ->> 'subject') = 'No puedo cambiar precios';
insert into results select 2, 'no ve solicitudes de otro estudio ni la bandeja',
  pg_temp.err($$select public.studio_support_requests('71000000-0000-0000-0000-000000000007')$$) = 'forbidden'
  and pg_temp.err($$select public.platform_support_requests(null)$$) = 'forbidden'
  and pg_temp.err($$select count(*) from public.support_requests$$) like 'permission denied%';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into results select 3, 'coach sin permiso',
  pg_temp.err($$select public.studio_create_support_request('70000000-0000-0000-0000-000000000007', 'Ayuda', '')$$) = 'forbidden';

-- 4 · La consola ve la bandeja con nombre comercial y resuelve con respuesta.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results select 4, 'bandeja de la consola',
  (select r -> 0 ->> 'studio_name' = 'Ayuda Studio' and r -> 0 ->> 'status' = 'open'
   from (select public.platform_support_requests('open') r) q);
select public.platform_resolve_support_request((select id from created), 'Listo, ya quedó');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 5, 'la dueña ve la respuesta',
  (select r -> 0 ->> 'status' = 'resolved' and r -> 0 ->> 'response' = 'Listo, ya quedó'
   from (select public.studio_support_requests('70000000-0000-0000-0000-000000000007') r) q);
reset role;
insert into results select 6, 'bitácora de crear y resolver',
  (select count(*) from public.platform_audit_log where action in ('support.request.created', 'support.request.resolved')
     and studio_id = '70000000-0000-0000-0000-000000000007') = 2;

-- 7 · Máximo 10 abiertas por estudio.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.studio_create_support_request('70000000-0000-0000-0000-000000000007', 'Solicitud ' || g, '') from generate_series(1, 10) g;
insert into results select 7, 'tope de abiertas',
  pg_temp.err($$select public.studio_create_support_request('70000000-0000-0000-0000-000000000007', 'Una más', '')$$) = 'support_too_many_open';
reset role;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 7 then 'NEB01 SUPPORT REQUESTS OK ' || count(*) else 'NEB01 SUPPORT REQUESTS FAIL' end from results;
rollback;
