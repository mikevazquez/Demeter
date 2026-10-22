-- NEB-01-01/02 · SQL checks on a disposable LOCAL database (scripts/neb01-sql-tests.sh).
\set ON_ERROR_STOP on
begin;

create temp table results (n int, name text, ok boolean);
grant all on results to authenticated, anon;

-- Setup as superuser: Mike is platform admin; studio B with owner and coach.
insert into public.platform_admins (user_id, note) values ('00000000-0000-0000-0000-0000000000a1', 'Mike');
insert into public.studios (id, name, slug) values ('20000000-0000-0000-0000-000000000002', 'Estudio B', 'estudio-b');
insert into public.studio_memberships values
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'coach', true);
do $$ begin
  for i in 1..5 loop
    insert into public.studios (name, slug) values ('Founding ' || i, 'founding-' || i);
  end loop;
end $$;

-- 1 · existing and new studios are All Access / internal (nothing changes for Demeter).
insert into results select 1, 'backfill y alta nacen internos',
  (select count(*) = 7 from public.studio_subscriptions where plan_key = 'allaccess' and status = 'internal');

-- 2 · a studio owner cannot use platform writes.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  perform public.platform_set_studio_plan('20000000-0000-0000-0000-000000000002', 'pro');
  insert into results values (2, 'dueño no puede cambiar plan', false);
exception when others then
  insert into results values (2, 'dueño no puede cambiar plan', sqlerrm = 'forbidden');
end $$;

-- 3 · owner reads own entitlements; cannot read another studio.
insert into results select 3, 'dueño lee sus derechos',
  (public.studio_entitlements('20000000-0000-0000-0000-000000000002') ->> 'plan') = 'allaccess';
do $$ begin
  perform public.studio_entitlements('10000000-0000-0000-0000-000000000001');
  insert into results values (4, 'dueño no lee otro estudio', false);
exception when others then
  insert into results values (4, 'dueño no lee otro estudio', sqlerrm = 'forbidden');
end $$;

-- 5 · coach (no settings.write) cannot select subscription rows; owner can.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into results select 5, 'coach no ve suscripción', (select count(*) = 0 from public.studio_subscriptions);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 6, 'dueño ve solo la suya', (select count(*) = 1 from public.studio_subscriptions);

-- Mike (platform admin).
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- 7 · Growth: recompensas y recursos sí, catálogo no; precio 1399; bitácora escrita.
insert into results select 7, 'growth incluye recompensas y recursos',
  (select e -> 'modules' = '{"recompensas": true, "recursos": true, "catalogo": false, "demi": false}'::jsonb
     and (e ->> 'monthly_price_mxn')::int = 1399 and e ->> 'status' = 'active'
   from (select public.platform_set_studio_plan('20000000-0000-0000-0000-000000000002', 'growth') as e) x);
insert into results select 8, 'cambio de plan en bitácora',
  (select count(*) = 1 from public.platform_audit_list('20000000-0000-0000-0000-000000000002') where action = 'studio.plan.set');

-- 9 · módulo suelto catálogo: 1399 + 299.
insert into results select 9, 'módulo suelto suma 299',
  (select (e ->> 'monthly_price_mxn')::int = 1698 and (e -> 'modules' ->> 'catalogo')::boolean
   from (select public.platform_set_studio_module('20000000-0000-0000-0000-000000000002', 'catalogo', true) as e) x);

-- 10 · 5 Founding llenan los lugares; el sexto falla.
do $$ declare r record; begin
  for r in select id from public.studios where slug like 'founding-%' loop
    perform public.platform_set_studio_plan(r.id, 'founding', 1::smallint);
  end loop;
end $$;
do $$ begin
  perform public.platform_set_studio_plan('20000000-0000-0000-0000-000000000002', 'founding');
  insert into results values (10, 'máximo 5 Founding', false);
exception when others then
  insert into results values (10, 'máximo 5 Founding', sqlerrm = 'founding_seats_full');
end $$;

-- 11 · Founding termina a los 12 meses; al pasar a Growth queda 30 % para siempre.
insert into results select 11, 'founding dura 12 meses',
  (select (public.studio_entitlements(id) ->> 'founding_ends_on')::date = (current_date + interval '12 months')::date
   from public.studios where slug = 'founding-1');
insert into results select 12, 'ex-founding con 30 %',
  (select (e ->> 'monthly_price_mxn')::int = 979 and (e ->> 'founding_alumni')::boolean
   from (select public.platform_set_studio_plan(id, 'growth') as e from public.studios where slug = 'founding-1') x);

-- 13 · suspendido: sin módulos y sin operar; solo lectura: módulos visibles pero no opera.
insert into results select 13, 'suspendido apaga todo',
  (select not (e ->> 'can_operate')::boolean and not (e -> 'modules' ->> 'recompensas')::boolean
   from (select public.platform_set_studio_status('20000000-0000-0000-0000-000000000002', 'suspended') as e) x);
insert into results select 14, 'solo lectura no opera',
  (select not (e ->> 'can_operate')::boolean and (e -> 'modules' ->> 'recompensas')::boolean
   from (select public.platform_set_studio_status('20000000-0000-0000-0000-000000000002', 'read_only') as e) x);

-- 15 · All Access no puede ponerse en gracia; sí suspenderse y reactivarse.
do $$ begin
  perform public.platform_set_studio_status('10000000-0000-0000-0000-000000000001', 'grace');
  insert into results values (15, 'all access no entra en gracia', false);
exception when others then
  insert into results values (15, 'all access no entra en gracia', sqlerrm = 'status_invalid');
end $$;
insert into results select 16, 'all access se suspende y reactiva',
  (select (public.platform_set_studio_status('10000000-0000-0000-0000-000000000001', 'suspended') ->> 'status') = 'suspended'
     and (public.platform_set_studio_plan('10000000-0000-0000-0000-000000000001', 'allaccess') ->> 'status') = 'internal');

-- 17 · la bitácora no se puede editar ni borrar (ni siquiera el superusuario).
reset role;
do $$ begin
  update public.platform_audit_log set action = 'tampered';
  insert into results values (17, 'bitácora inmutable', false);
exception when others then
  insert into results values (17, 'bitácora inmutable', sqlerrm = 'platform_audit_immutable');
end $$;

-- 18 · anónimo no ve nada.
set local role anon;
do $$ begin
  perform public.platform_is_admin();
  insert into results values (18, 'anónimo sin acceso', false);
exception when others then
  insert into results values (18, 'anónimo sin acceso', true);
end $$;
reset role;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 18 then 'NEB01 PLATFORM OK ' || count(*) else 'NEB01 PLATFORM FAIL' end from results;
rollback;
