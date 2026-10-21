-- POLE-FIGURAS-01 · Pruebas de base de datos (harness local).
--
-- Cómo correrlo en un Postgres 16 desechable:
--   1. Crear una base vacía y cargar los stubs de Supabase (roles anon/authenticated,
--      auth.uid(), storage.*, tablas base y helpers private.*) — ver la sección STUBS abajo.
--   2. Aplicar supabase/migrations/20261012220000_pole_figures_module.sql.
--   3. Copiar lib/pole/catalog-seed.json a /tmp/pgpole/seed.json y correr la sección PRUEBAS.
-- Los errores marcados "esperado:" deben aparecer; el resto debe pasar.
-- NO correr en producción.

-- =============================== STUBS ===============================
-- Minimal Supabase-like stub to exercise the pole migration locally.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
create schema storage;
grant usage on schema auth, private, storage, public to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;

create table public.studios (id uuid primary key default gen_random_uuid(), name text);
create table public.disciplines (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), name text not null, active boolean default true, unique(studio_id,name));
create table public.students (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), user_id uuid references auth.users(id), full_name text not null, active boolean not null default true, lifecycle_status text not null default 'active');
create table public.studio_memberships (studio_id uuid, user_id uuid, role text, active boolean default true);
create table public.role_capabilities (role text, capability_key text);
create table public.class_templates (id uuid primary key default gen_random_uuid(), studio_id uuid, discipline_id uuid references public.disciplines(id), name text);
create table public.class_sessions (id uuid primary key default gen_random_uuid(), studio_id uuid not null, template_id uuid references public.class_templates(id), starts_at timestamptz default now());
create table public.reservations (id uuid primary key default gen_random_uuid(), studio_id uuid, session_id uuid references public.class_sessions(id), student_id uuid references public.students(id), status text);

create table public.technical_level_definitions (id uuid primary key default gen_random_uuid(), studio_id uuid not null, level_key text not null, title text not null, level_order smallint not null, active boolean default true, unique(studio_id, level_key));
create table public.discipline_technical_levels (id uuid primary key default gen_random_uuid(), studio_id uuid not null, discipline_id uuid not null, technical_level_id uuid not null references public.technical_level_definitions(id), discipline_order smallint not null, active boolean default true);
create table public.student_discipline_levels (id uuid primary key default gen_random_uuid(), studio_id uuid not null, student_id uuid not null references public.students(id), discipline_id uuid not null, discipline_technical_level_id uuid not null references public.discipline_technical_levels(id), unique(studio_id, student_id, discipline_id));
create table public.technical_elements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  element_kind text not null check (element_kind in ('figure', 'skill', 'transition', 'theory')),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id)
);
create unique index technical_elements_name_uq on public.technical_elements (studio_id, discipline_id, lower(name));
create table public.technical_combos (id uuid primary key default gen_random_uuid(), studio_id uuid not null, discipline_id uuid not null, name text not null, description text, active boolean default true);
create unique index technical_combos_name_uq on public.technical_combos (studio_id, discipline_id, lower(name));
create table public.technical_combo_items (id uuid primary key default gen_random_uuid(), studio_id uuid not null, combo_id uuid not null references public.technical_combos(id) on delete cascade, element_id uuid not null references public.technical_elements(id), position smallint not null, notes text, unique(combo_id, position));

create or replace function private.has_capability(p_studio_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_memberships m join public.role_capabilities rc on rc.role = m.role
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid()) and m.active = true and rc.capability_key = p_capability);
$$;
create or replace function private.is_current_student(target_student_id uuid, target_studio_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s join public.studio_memberships sm on sm.studio_id=s.studio_id and sm.user_id=(select auth.uid()) and sm.role='student' and sm.active=true
    where s.id=target_student_id and s.studio_id=target_studio_id and s.user_id=(select auth.uid()) and s.active=true and s.lifecycle_status='active' and private.has_capability(s.studio_id,'student.portal'));
$$;
create or replace function private.evaluations_require_capability(p_studio_id uuid, p_capability text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_capability(p_studio_id, p_capability) then
    raise exception 'evaluation_access_denied';
  end if;
end; $$;
grant execute on function private.has_capability(uuid,text), private.is_current_student(uuid,uuid) to authenticated;
grant select on all tables in schema public to authenticated;
insert into public.role_capabilities values
 ('owner','evaluations.read'),('owner','evaluations.write'),('owner','evaluations.configure'),
 ('instructor','evaluations.read'),('instructor','evaluations.write'),('student','student.portal');

-- =============================== PRUEBAS ===============================
\set ON_ERROR_STOP on
-- Datos base
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1'), -- owner
 ('00000000-0000-0000-0000-0000000000b1'), -- ana
 ('00000000-0000-0000-0000-0000000000b2'), -- sofia
 ('00000000-0000-0000-0000-0000000000b3'), -- valeria
 ('00000000-0000-0000-0000-0000000000c1'); -- outsider
insert into public.studios (id,name) values ('11111111-1111-4111-8111-111111111111','Demeter');
insert into public.disciplines (id,studio_id,name) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Pole Fitness');
insert into public.studio_memberships values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000a1','owner',true),
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b1','student',true),
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b2','student',true),
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b3','student',true);
insert into public.students (id,studio_id,user_id,full_name) values
 ('33333333-0000-4000-8000-0000000000b1','11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b1','Ana'),
 ('33333333-0000-4000-8000-0000000000b2','11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b2','Sofía'),
 ('33333333-0000-4000-8000-0000000000b3','11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b3','Valeria');
insert into public.technical_level_definitions (id,studio_id,level_key,title,level_order) values
 ('44444444-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','beginner','Principiante',1),
 ('44444444-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','intermediate','Intermedio',2),
 ('44444444-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','upper_intermediate','Intermedio Avanzado',3),
 ('44444444-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','advanced','Avanzado',4),
 ('44444444-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','elite','Élite',5);
insert into public.discipline_technical_levels (id,studio_id,discipline_id,technical_level_id,discipline_order)
select gen_random_uuid(),'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',id,level_order from public.technical_level_definitions;
insert into public.student_discipline_levels (studio_id,student_id,discipline_id,discipline_technical_level_id)
select '11111111-1111-4111-8111-111111111111', s.id::uuid, '22222222-2222-4222-8222-222222222222', dtl.id
from (values ('33333333-0000-4000-8000-0000000000b1','beginner'),('33333333-0000-4000-8000-0000000000b2','beginner'),('33333333-0000-4000-8000-0000000000b3','advanced')) s(id,lk)
join public.technical_level_definitions tld on tld.level_key = s.lk
join public.discipline_technical_levels dtl on dtl.technical_level_id = tld.id;
insert into public.class_templates (id,studio_id,discipline_id,name) values ('55555555-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Pole Fitness');
insert into public.class_sessions (id,studio_id,template_id) values ('66666666-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','55555555-0000-4000-8000-000000000001');
insert into public.reservations (studio_id,session_id,student_id,status) values
 ('11111111-1111-4111-8111-111111111111','66666666-0000-4000-8000-000000000001','33333333-0000-4000-8000-0000000000b1','reserved'),
 ('11111111-1111-4111-8111-111111111111','66666666-0000-4000-8000-000000000001','33333333-0000-4000-8000-0000000000b3','attended');
-- elemento preexistente en la biblioteca con el mismo nombre que una figura (debe reutilizarse)
insert into public.technical_elements (studio_id,discipline_id,name,element_kind) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Mariposa','skill');

-- Import como owner
create table public.tmp_seed as select pg_read_file('/tmp/pgpole/seed.json')::jsonb j;
grant select on public.tmp_seed to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select public.admin_import_pole_catalog('22222222-2222-4222-8222-222222222222', (select j from public.tmp_seed)) as import1;
select public.admin_import_pole_catalog('22222222-2222-4222-8222-222222222222', (select j from public.tmp_seed)) as import2_idempotent;
reset role;
select count(*) as profiles, count(*) filter (where in_core_program) as core, count(*) filter (where catalog_level='profesional') as pro from public.pole_figure_profiles;
select count(*) as prereqs from public.pole_figure_prerequisites;
select count(*) as combos from public.technical_combos; select count(*) as combo_items from public.technical_combo_items;
select te.name, te.element_kind, p.slug from public.technical_elements te join public.pole_figure_profiles p on p.element_id=te.id where p.slug in ('butterfly','ballerina-variation','ballerina-variation-2','elbow-genie');
select count(*) filter (where not te.active) as inactive from public.technical_elements te;

\set ON_ERROR_STOP off
\set VERBOSITY terse
create or replace function pg_temp.fid(p text) returns uuid language sql as $$ select element_id from public.pole_figure_profiles where slug=p $$;
create table public.tmp_ids as select slug, element_id from public.pole_figure_profiles;
grant select on public.tmp_ids to authenticated;
-- Ana marca sus 15 figuras en orden (respetando prerrequisitos)
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select count(*) as ana_marked from unnest(array['pole-squat','step-around','pirouette','ballerina-upright','basic-fireman','firelady','front-hook','back-hook','attitude-spin','chair','carousel','boomerang','basic-climb','cradle','side-spin']) s, lateral public.student_mark_pole_figure((select element_id from public.tmp_ids where slug=s)) r;
\echo '--- esperado: next_level'
select public.student_mark_pole_figure((select element_id from public.tmp_ids where slug='basic-invert'));
\echo '--- esperado: prerequisites_missing'
select public.student_mark_pole_figure((select element_id from public.tmp_ids where slug='dropped-tuck-spin'));
\echo '--- esperado: requires_authorization'
select public.student_mark_pole_figure((select element_id from public.tmp_ids where slug='reverse-ayesha'));
\echo '--- idempotente'
select public.student_mark_pole_figure((select element_id from public.tmp_ids where slug='chair'));
\echo '--- Ana ve solo lo suyo'
select count(*) as ana_rows from public.student_pole_achievements;
select (public.student_pole_figures(null)->'level') as ana_level, jsonb_array_length(public.student_pole_figures(null)->'figures') as figures;
\echo '--- esperado: forbidden staff rpc'
select public.staff_set_pole_authorization('33333333-0000-4000-8000-0000000000b3',(select element_id from public.tmp_ids where slug='reverse-ayesha'),true);
\echo '--- foto: ruta invalida'
select public.student_set_pole_photo((select element_id from public.tmp_ids where slug='chair'),'otro/xx.jpg');
select public.student_set_pole_photo((select element_id from public.tmp_ids where slug='chair'),'00000000-0000-0000-0000-0000000000b1/'||(select element_id from public.tmp_ids where slug='chair')||'/1.jpg');
select public.student_unmark_pole_figure((select element_id from public.tmp_ids where slug='chair'));
-- staff
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
\echo '--- esperado: not eligible (Ana principiante)'
select public.staff_set_pole_authorization('33333333-0000-4000-8000-0000000000b1',(select element_id from public.tmp_ids where slug='reverse-ayesha'),true);
\echo '--- autoriza Valeria'
select public.staff_set_pole_authorization('33333333-0000-4000-8000-0000000000b3',(select element_id from public.tmp_ids where slug='reverse-ayesha'),true);
\echo '--- esperado: not professional'
select public.staff_set_pole_authorization('33333333-0000-4000-8000-0000000000b3',(select element_id from public.tmp_ids where slug='jade'),true);
\echo '--- valida Ana en clase'
select public.staff_validate_pole_figures('66666666-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('student_id','33333333-0000-4000-8000-0000000000b1','element_id',(select element_id from public.tmp_ids where slug='pike-fireman'))));
\echo '--- esperado: student_not_in_session (Sofia)'
select public.staff_validate_pole_figures('66666666-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('student_id','33333333-0000-4000-8000-0000000000b2','element_id',(select element_id from public.tmp_ids where slug='pike-fireman'))));
\echo '--- plan'
select public.staff_save_pole_plan('66666666-0000-4000-8000-000000000001','principiante', array[(select element_id from public.tmp_ids where slug='basic-fireman'),(select element_id from public.tmp_ids where slug='pike-fireman')], (select element_id from public.tmp_ids where slug='pike-fireman'), array['33333333-0000-4000-8000-0000000000b1'::uuid]) is not null as plan_saved;
\echo '--- esperado: plan con pro rechazado'
select public.staff_save_pole_plan('66666666-0000-4000-8000-000000000001','avanzado', array[(select element_id from public.tmp_ids where slug='reverse-ayesha')], null, '{}');
\echo '--- esperado: ciclo'
insert into public.pole_figure_prerequisites values ('11111111-1111-4111-8111-111111111111',(select element_id from public.tmp_ids where slug='basic-climb'),(select element_id from public.tmp_ids where slug='split-seat'));
select count(*) as staff_sees_achievements from public.student_pole_achievements;
-- Valeria marca la autorizada
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',false);
select public.student_mark_pole_figure((select element_id from public.tmp_ids where slug='reverse-ayesha'));
select (public.student_pole_figures(null)->'level') as valeria_level;
-- outsider
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
\echo '--- esperado: student_not_found / 0 filas'
select public.student_pole_figures(null);
select count(*) as outsider_rows from public.student_pole_achievements;
select count(*) as outsider_profiles from public.pole_figure_profiles;
reset role;
select event_type, actor_kind, count(*) from public.pole_achievement_events group by 1,2 order by 1;
select source, validated_at is not null as validated from public.student_pole_achievements a join public.pole_figure_profiles p on p.element_id=a.element_id where p.slug='pike-fireman';
