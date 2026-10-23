-- NEB-01-18 · detector de errores de configuración (local DB only).
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

-- Stand-ins only for what the rules read.
create table if not exists public.product_templates (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  name text not null, product_type text not null default 'package', price_minor integer not null default 0,
  credit_limit integer, validity_days integer, unlimited boolean not null default false,
  active boolean not null default true, online_purchasable boolean not null default false,
  updated_at timestamptz not null default now());
alter table public.class_sessions add column if not exists ends_at timestamptz,
  add column if not exists capacity integer not null default 10,
  add column if not exists instructor_id uuid, add column if not exists coach_user_id uuid;
alter table public.class_templates add column if not exists active boolean not null default true,
  add column if not exists workshop_offer_id uuid, add column if not exists drop_in_price_minor integer;
alter table public.students add column if not exists person_id uuid,
  add column if not exists lifecycle_status text not null default 'active';
create table if not exists public.studio_payment_methods (studio_id uuid not null, code text not null, active boolean not null default true);
create table if not exists public.profile_field_definitions (id uuid primary key default gen_random_uuid(), studio_id uuid not null, entity_type text not null, key text not null, active boolean not null default true);
create table if not exists public.profile_field_values (id uuid primary key default gen_random_uuid(), studio_id uuid not null, person_id uuid not null, definition_id uuid not null, value jsonb);
alter table public.sales add column if not exists payment_due_on date;

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
insert into public.studios (id, name, slug) values
  ('60000000-0000-0000-0000-000000000006', 'Estudio Revisión', 'revision'),
  ('61000000-0000-0000-0000-000000000006', 'Estudio Limpio', 'limpio');
insert into public.studio_memberships values
  ('60000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b1', 'owner', true);

-- Estudio con problemas: paquete en $0, paquete sin clases ni vigencia, clase sin coach y con cupo 0,
-- actividad sin precio suelto, sin políticas, sin métodos de pago y una alumna sin fecha de nacimiento.
insert into public.product_templates (studio_id, name, product_type, price_minor, credit_limit, validity_days) values
  ('60000000-0000-0000-0000-000000000006', 'Gratis por error', 'package', 0, 8, 30),
  ('60000000-0000-0000-0000-000000000006', 'Sin clases', 'package', 90000, null, null),
  ('60000000-0000-0000-0000-000000000006', 'Inactivo en cero', 'package', 0, 4, 30);
update public.product_templates set active = false where name = 'Inactivo en cero';
insert into public.class_templates (id, studio_id, name) values ('62000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000006', 'Yoga');
insert into public.class_sessions (studio_id, template_id, starts_at, capacity) values
  ('60000000-0000-0000-0000-000000000006', '62000000-0000-0000-0000-000000000006', now() + interval '2 days', 0);
insert into public.students (studio_id, person_id) values ('60000000-0000-0000-0000-000000000006', gen_random_uuid());

-- Estudio limpio: todo en orden.
insert into public.product_templates (studio_id, name, product_type, price_minor, credit_limit, validity_days) values
  ('61000000-0000-0000-0000-000000000006', 'Paquete 8', 'package', 120000, 8, 30);
insert into public.class_templates (studio_id, name, drop_in_price_minor) values ('61000000-0000-0000-0000-000000000006', 'Pilates', 25000);
insert into public.class_sessions (studio_id, starts_at, capacity, instructor_id) values
  ('61000000-0000-0000-0000-000000000006', now() + interval '2 days', 10, gen_random_uuid());
insert into public.studio_operating_policies (studio_id) values ('61000000-0000-0000-0000-000000000006');
insert into public.studio_payment_methods values ('61000000-0000-0000-0000-000000000006', 'cash', true);

create temp table issues as
select e->>'code' code, e->>'severity' severity, (e->>'count')::int cnt, e->>'href' href
from jsonb_array_elements(private.studio_config_issues('60000000-0000-0000-0000-000000000006')) e;

insert into results select 1, 'detecta las 9 reglas con su gravedad',
  (select array_agg(code || ':' || severity || ':' || cnt order by code) from issues) = array[
    'activity_drop_in_missing:suggestion:1', 'operating_policy_missing:warning:1', 'package_credits_missing:error:1',
    'package_validity_missing:warning:1', 'payment_methods_missing:error:1', 'product_price_missing:error:1',
    'session_capacity_zero:error:1', 'session_coach_missing:warning:1', 'student_birth_date_missing:suggestion:1'];
insert into results select 2, 'inactivos no cuentan y cada regla trae corrección',
  (select cnt from issues where code = 'product_price_missing') = 1
  and (select href from issues where code = 'product_price_missing') = '/admin/productos'
  and (select href from issues where code = 'payment_methods_missing') is null;
insert into results select 3, 'estudio limpio sin problemas',
  jsonb_array_length(private.studio_config_issues('61000000-0000-0000-0000-000000000006')) = 0;

-- 4 · La dueña ve los suyos; no los de otro estudio.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 4, 'dueña ve su revisión, no la de otro estudio',
  jsonb_array_length(public.studio_config_issues('60000000-0000-0000-0000-000000000006')) = 9
  and pg_temp.err($$select public.studio_config_issues('61000000-0000-0000-0000-000000000006')$$) = 'forbidden'
  and pg_temp.err($$select public.platform_config_issue_counts()$$) = 'forbidden';

-- 5 · Consola: conteos por estudio.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results select 5, 'conteos para la consola',
  (public.platform_config_issue_counts() -> '60000000-0000-0000-0000-000000000006' ->> 'errors')::int = 4
  and (public.platform_config_issue_counts() -> '60000000-0000-0000-0000-000000000006' ->> 'warnings')::int = 3
  and (public.platform_config_issue_counts() -> '61000000-0000-0000-0000-000000000006' ->> 'errors')::int = 0;
reset role;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 5 then 'NEB01 CONFIG ISSUES OK ' || count(*) else 'NEB01 CONFIG ISSUES FAIL' end from results;
rollback;
