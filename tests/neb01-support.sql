-- NEB-01-17 · entrar al estudio como soporte, con aviso al dueño y bitácora (local DB only).
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

-- Stand-ins only for what the support reads touch.
create table if not exists public.product_templates (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  name text not null, product_type text not null default 'package', price_minor integer not null default 0,
  credit_limit integer, validity_days integer, unlimited boolean not null default false,
  active boolean not null default true, online_purchasable boolean not null default false,
  updated_at timestamptz not null default now());
alter table public.class_sessions add column if not exists ends_at timestamptz, add column if not exists capacity integer not null default 10;
alter table public.sales add column if not exists payment_due_on date;

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1')
  on conflict do nothing;
insert into public.studios (id, name, slug) values ('50000000-0000-0000-0000-000000000005', 'Estudio Soporte', 'soporte');
insert into public.studio_memberships values
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1', 'owner', true);
insert into public.product_templates (id, studio_id, name, price_minor) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000005', 'Paquete 8 clases', 120000);
insert into public.class_templates (id, studio_id, name) values
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000005', 'Pole Fitness');
insert into public.class_sessions (id, studio_id, template_id, starts_at, ends_at, capacity) values
  ('53000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000005', '52000000-0000-0000-0000-000000000001',
   now() + interval '1 day', now() + interval '1 day 1 hour', 12);
insert into public.reservations (studio_id, session_id, status) values
  ('50000000-0000-0000-0000-000000000005', '53000000-0000-0000-0000-000000000001', 'reserved');

-- 1 · Sin sesión de soporte no se ven pestañas, aunque sea admin de plataforma.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results select 1, 'sin sesión no hay acceso',
  pg_temp.err($$select public.platform_support_packages('50000000-0000-0000-0000-000000000005')$$) = 'support_session_required'
  and (public.platform_support_state('50000000-0000-0000-0000-000000000005')->>'active') = 'false';

-- 2 · Motivo obligatorio; 3 · entrar abre 2 horas y queda en bitácora; repetir no abre otra.
insert into results select 2, 'motivo obligatorio',
  pg_temp.err($$select public.platform_start_support_session('50000000-0000-0000-0000-000000000005', ' ')$$) = 'support_reason_required';
create temp table s1 as select public.platform_start_support_session('50000000-0000-0000-0000-000000000005', 'Revisar   precios') s;
create temp table s2 as select public.platform_start_support_session('50000000-0000-0000-0000-000000000005', 'Otra vez') s;
reset role;
insert into results select 3, 'sesión de 2 horas, una sola',
  (select (s->>'expires_at')::timestamptz - (s->>'started_at')::timestamptz = interval '2 hours' and s->>'reason' = 'Revisar precios' from s1)
  and (select s1.s->>'session_id' = s2.s->>'session_id' from s1, s2)
  and (select count(*) from public.platform_support_sessions) = 1
  and exists (select 1 from public.platform_audit_log where action = 'support.session.start' and detail->>'reason' = 'Revisar precios');

-- 4 · Cada pestaña leída queda en bitácora.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
create temp table reads as select
  public.platform_support_packages('50000000-0000-0000-0000-000000000005') pk,
  public.platform_support_schedule('50000000-0000-0000-0000-000000000005', 14) sc,
  public.platform_support_diagnostics('50000000-0000-0000-0000-000000000005') dg;
reset role;
insert into results select 4, 'lecturas con bitácora',
  (select jsonb_array_length(pk) = 1 and pk->0->>'name' = 'Paquete 8 clases'
     and sc->0->>'class_name' = 'Pole Fitness' and (sc->0->>'reserved')::int = 1 and (sc->0->>'capacity')::int = 12
     and (dg->>'classes_next_7_days')::int = 1 and (dg->>'reservations_next_7_days')::int = 1 from reads)
  and (select array_agg(detail->>'tab' order by detail->>'tab') from public.platform_audit_log where action = 'support.read')
      = array['diagnostico', 'horario', 'paquetes'];

-- 5 · Editar paquete: cambia y deja antes/después; datos inválidos no pasan.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_support_update_package('50000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001', 'Paquete 8 clases', 130000, true);
insert into results select 6, 'validaciones del paquete',
  pg_temp.err($$select public.platform_support_update_package('50000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001', 'x', 1, true)$$) = 'product_name_invalid'
  and pg_temp.err($$select public.platform_support_update_package('50000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001', 'Paquete', -1, true)$$) = 'product_price_invalid'
  and pg_temp.err($$select public.platform_support_update_package('40000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000001', 'Paquete', 1, true)$$) = 'support_session_required';
reset role;
insert into results select 5, 'cambio con antes y después',
  (select price_minor from public.product_templates where id = '51000000-0000-0000-0000-000000000001') = 130000
  and exists (select 1 from public.platform_audit_log where action = 'support.package.update'
    and (detail#>>'{before,price_minor}')::int = 120000 and (detail#>>'{after,price_minor}')::int = 130000);

-- 7 · La dueña ve el aviso y el cambio; 8 · la tabla no se lee directo.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
create temp table owner_view as select public.studio_support_access('50000000-0000-0000-0000-000000000005') v;
insert into results select 8, 'tabla cerrada y consola solo plataforma',
  pg_temp.err($$select count(*) from public.platform_support_sessions$$) like 'permission denied%'
  and pg_temp.err($$select public.platform_start_support_session('50000000-0000-0000-0000-000000000005', 'Hola')$$) = 'forbidden';
reset role;
insert into results select 7, 'aviso a la dueña',
  (select v#>>'{active,reason}' = 'Revisar precios' and (v#>>'{recent,0,changes}')::int = 1 from owner_view);

-- 9 · Salir cierra la sesión; 10 · una sesión vencida se cierra sola.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_end_support_session('50000000-0000-0000-0000-000000000005');
reset role;
insert into results select 9, 'salir del estudio',
  (select ended_at is not null from public.platform_support_sessions)
  and exists (select 1 from public.platform_audit_log where action = 'support.session.end');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_start_support_session('50000000-0000-0000-0000-000000000005', 'Segunda revisión');
reset role;
update public.platform_support_sessions set started_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' where ended_at is null;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results select 10, 'sesión vencida se cierra sola',
  pg_temp.err($$select public.platform_support_schedule('50000000-0000-0000-0000-000000000005')$$) = 'support_session_required'
  and (public.platform_support_state('50000000-0000-0000-0000-000000000005')->>'active') = 'false';
reset role;
insert into results select 11, 'vencida registrada',
  exists (select 1 from public.platform_audit_log where action = 'support.session.expired')
  and not exists (select 1 from public.platform_support_sessions where ended_at is null);

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 11 then 'NEB01 SUPPORT OK ' || count(*) else 'NEB01 SUPPORT FAIL' end from results;
rollback;
