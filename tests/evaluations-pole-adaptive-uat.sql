-- Isolated PostgreSQL test using explicit base-service doubles and canonical C1 columns.
-- Run from repository root via the documented Docker command. Not a Sandbox UAT.
\set ON_ERROR_STOP on
\ir fixtures/pole-evaluations-base.sql
-- =============================== STUBS ===============================
create table public.evaluation_invitations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  student_id uuid,
  reservation_id uuid references public.reservations(id)
);
create table public.evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  discipline_id uuid not null,
  discipline_technical_level_id uuid not null references public.discipline_technical_levels(id),
  name text not null,
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.evaluation_template_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  template_id uuid not null references public.evaluation_templates(id) on delete cascade,
  version_number integer not null,
  status text not null default 'draft',
  schema_version smallint not null default 1,
  pass_threshold numeric(5,2) not null default 80,
  default_category_min numeric(5,2) not null default 70,
  default_attempts_per_element smallint not null default 3,
  default_attempts_per_combo smallint not null default 3,
  evaluator_instructions text,
  created_by uuid,
  activated_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz default now(),
  unique (template_id, version_number)
);
create table public.evaluation_template_criteria (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  template_version_id uuid not null references public.evaluation_template_versions(id) on delete cascade,
  criterion_key text not null check (criterion_key ~ '^[a-z0-9_]+$'),
  label text not null,
  description text,
  weight_percent numeric(5,2) not null,
  min_percent numeric(5,2),
  sort_order smallint not null check (sort_order > 0),
  block_type text not null default 'direct_score'
    check (block_type in ('direct_score','weighted_criteria','element_list','correct_incorrect','meets')),
  progression_required boolean not null default false,
  evaluator_instructions text,
  unique (template_version_id, criterion_key),
  unique (template_version_id, sort_order)
);
create table public.evaluation_template_elements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  template_version_id uuid not null references public.evaluation_template_versions(id) on delete cascade,
  element_id uuid not null references public.technical_elements(id),
  criterion_id uuid references public.evaluation_template_criteria(id),
  mandatory boolean not null default false,
  scored boolean not null default true,
  max_score numeric(6,2) not null default 10,
  min_score numeric(6,2),
  attempts_allowed smallint,
  sort_order smallint not null check (sort_order > 0),
  item_label text,
  item_description text,
  item_kind text not null default 'element' check (item_kind in ('criterion','element','question')),
  item_weight_percent numeric(5,2),
  progression_required boolean not null default false,
  element_snapshot jsonb not null default '{}'::jsonb,
  unique (template_version_id, element_id),
  unique (template_version_id, sort_order)
);
create table public.technical_evaluations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  student_id uuid references public.students(id),
  student_name_snapshot text not null default 'x',
  discipline_id uuid not null,
  current_discipline_level_id_at_start uuid,
  target_discipline_level_id uuid not null,
  resulting_discipline_level_id uuid,
  template_version_id uuid not null references public.evaluation_template_versions(id),
  evaluation_purpose text not null default 'progression',
  evaluation_date date not null default current_date,
  status text not null default 'draft',
  final_outcome text,
  published_at timestamptz,
  evaluation_invitation_id uuid references public.evaluation_invitations(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.technical_evaluation_element_results (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  template_element_id uuid not null references public.evaluation_template_elements(id),
  result_status text not null default 'not_evaluated',
  unique (evaluation_id, template_element_id)
);

\ir ../supabase/migrations/20260922012000_evaluaciones02_progression_validation.sql
\ir ../supabase/migrations/20261020090000_evaluaciones04_pole_adaptive.sql

-- =============================== PRUEBAS ===============================
\set ON_ERROR_STOP on
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1'), -- owner
 ('00000000-0000-0000-0000-0000000000b1'), -- ana
 ('00000000-0000-0000-0000-0000000000c1'); -- outsider
insert into public.studios (id,name) values ('11111111-1111-4111-8111-111111111111','Demeter');
insert into public.disciplines (id,studio_id,name) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Pole Fitness');
insert into public.studio_memberships values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000a1','owner',true),
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b1','student',true);
insert into public.students (id,studio_id,user_id,full_name) values
 ('33333333-0000-4000-8000-0000000000b1','11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-0000000000b1','Ana');
insert into public.technical_level_definitions (id,studio_id,level_key,title,level_order) values
 ('44444444-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','beginner','Principiante',1),
 ('44444444-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','intermediate','Intermedio',2),
 ('44444444-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','upper_intermediate','Intermedio avanzado',3),
 ('44444444-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','advanced','Avanzado',4),
 ('44444444-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','elite','Élite',5);
insert into public.discipline_technical_levels (id,studio_id,discipline_id,technical_level_id,discipline_order)
select ('55555555-0000-4000-8000-00000000000' || level_order)::uuid, studio_id,
       '22222222-2222-4222-8222-222222222222', id, level_order
from public.technical_level_definitions;
insert into public.student_discipline_levels (studio_id,student_id,discipline_id,discipline_technical_level_id) values
 ('11111111-1111-4111-8111-111111111111','33333333-0000-4000-8000-0000000000b1','22222222-2222-4222-8222-222222222222','55555555-0000-4000-8000-000000000001');
insert into public.class_templates (id,studio_id,discipline_id,name) values
 ('66666666-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Pole');
insert into public.class_sessions (id,studio_id,template_id) values
 ('77777777-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','66666666-0000-4000-8000-000000000001');
insert into public.reservations (id,studio_id,session_id,student_id,status) values
 ('88888888-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000001','33333333-0000-4000-8000-0000000000b1','reserved');
insert into public.evaluation_invitations (id,studio_id,student_id,reservation_id) values
 ('99999999-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','33333333-0000-4000-8000-0000000000b1','88888888-0000-4000-8000-000000000001');
grant select on all tables in schema public to authenticated;

-- Seed from the same catalogue artifact used by C1; runner supplies one CSV JSON cell.
create temporary table catalogue_input (j jsonb);
\copy catalogue_input from '/tmp/pole-evaluations-seed.csv' csv
insert into public.technical_elements(studio_id,discipline_id,name,element_kind)
select '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',(f->>'nombre') || ' [' || (f->>'id') || ']','figure'
from catalogue_input, jsonb_array_elements(j->'figuras') f;
insert into public.pole_figure_profiles(element_id,studio_id,discipline_id,slug,original_name,catalog_level,figure_type,family,in_core_program,sort_order)
select e.id,e.studio_id,e.discipline_id,f->>'id',f->>'nombre',
 case f->>'nivel' when 'Principiante' then 'principiante' when 'Intermedio' then 'intermedio' when 'Avanzado' then 'avanzado' else 'profesional' end,
 f->>'tipo',f->>'familia',(f->>'programa_base')::boolean,n
from catalogue_input, jsonb_array_elements(j->'figuras') with ordinality x(f,n)
join public.technical_elements e on e.name=(f->>'nombre') || ' [' || (f->>'id') || ']';
insert into public.pole_figure_prerequisites(studio_id,figure_element_id,required_element_id)
select p.studio_id,p.element_id,r.element_id
from catalogue_input, jsonb_array_elements(j->'figuras') f
join public.pole_figure_profiles p on p.slug=f->>'id'
cross join lateral jsonb_array_elements_text(f->'prerrequisitos_sugeridos') req
join public.pole_figure_profiles r on r.slug=req;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);

-- 1) Plantillas base: una por nivel, activas, y la segunda vez no crea nada.
select jsonb_array_length(public.admin_seed_pole_evaluation_templates('22222222-2222-4222-8222-222222222222') -> 'created') as created_first;
select jsonb_array_length(r -> 'created') as created_second, jsonb_array_length(r -> 'skipped') as skipped_second
from (select public.admin_seed_pole_evaluation_templates('22222222-2222-4222-8222-222222222222') r) x;
reset role;

select tld.title, v.status, c.block_type, count(te.id) as figures, sum(c.weight_percent) filter (where te.id is null) as w
from public.evaluation_templates t
join public.discipline_technical_levels dtl on dtl.id = t.discipline_technical_level_id
join public.technical_level_definitions tld on tld.id = dtl.technical_level_id
join public.evaluation_template_versions v on v.template_id = t.id
join public.evaluation_template_criteria c on c.template_version_id = v.id
left join public.evaluation_template_elements te on te.criterion_id = c.id
group by tld.level_order, tld.title, v.status, c.block_type, c.sort_order
order by tld.level_order, c.sort_order;

-- Intermedio e Intermedio avanzado no comparten figuras.
select count(*) as shared_intermediate_figures
from public.evaluation_template_elements a
join public.evaluation_template_elements b on a.element_id = b.element_id and a.id <> b.id;

-- Ninguna figura Profesional en plantillas.
select count(*) as pro_in_templates
from public.evaluation_template_elements te
join public.pole_figure_profiles p on p.element_id = te.element_id
where p.catalog_level = 'profesional';

-- 2) Ana (principiante) con figuras logradas.
create table public.tmp_slug (slug text primary key, id uuid);
insert into public.tmp_slug select slug, element_id from public.pole_figure_profiles;
insert into public.student_pole_figure_achievements (studio_id, student_id, figure_element_id, source, achieved_at, validated_at)
select '11111111-1111-4111-8111-111111111111','33333333-0000-4000-8000-0000000000b1', id,
       case when slug in ('firelady','attitude-spin','boomerang','reverse-grab-prep') then 'student' else 'instructor' end,
       now() - (row_number() over (order by slug)) * interval '1 day',
       case when slug in ('firelady','attitude-spin','boomerang','reverse-grab-prep') then null else now() end
from public.tmp_slug
where slug in ('pole-squat','step-around','pirouette','ballerina-upright','basic-fireman','firelady',
  'front-hook','back-hook','attitude-spin','chair','carousel','boomerang','basic-climb','cradle',
  'side-spin','reverse-grab-prep','crossed-knee-seat','standing-crucifix','invert-prep-crucifix');

-- Evaluación anterior publicada (septiembre) con figuras no cumplidas.
insert into public.technical_evaluations (id, studio_id, student_id, discipline_id, target_discipline_level_id, template_version_id, evaluation_date, status)
select 'aaaaaaaa-0000-4000-8000-000000000001', t.studio_id, '33333333-0000-4000-8000-0000000000b1', t.discipline_id,
       t.discipline_technical_level_id, v.id, date '2026-09-14', 'draft'
from public.evaluation_templates t join public.evaluation_template_versions v on v.template_id = t.id
where t.discipline_technical_level_id = '55555555-0000-4000-8000-000000000001';
insert into public.technical_evaluation_element_results (studio_id, evaluation_id, template_element_id, result_status)
select te.studio_id, 'aaaaaaaa-0000-4000-8000-000000000001', te.id,
       case when te.sort_order <= 2 then 'does_not_meet' else 'meets' end
from public.evaluation_template_elements te
join public.evaluation_templates t on true
join public.evaluation_template_versions v on v.template_id = t.id and v.id = te.template_version_id
where t.discipline_technical_level_id = '55555555-0000-4000-8000-000000000001';
-- Una figura de su parte personalizada de septiembre tampoco salió.
update public.technical_evaluation_personal_items set result_status = 'does_not_meet'
where id = (select id from public.technical_evaluation_personal_items
            where evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000001' order by sort_order limit 1);
select p.slug as failed_in_september
from public.technical_evaluation_personal_items pi join public.pole_figure_profiles p on p.element_id = pi.element_id
where pi.evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000001' and pi.result_status = 'does_not_meet';
update public.technical_evaluations set status = 'published', final_outcome = 'stays', published_at = now() - interval '30 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Figuras de la plantilla Principiante que cumplió quedan validadas.
select count(*) filter (where a.validated_at is not null and a.source = 'instructor') as validated_from_first_eval
from public.student_pole_figure_achievements a
join public.evaluation_template_elements te on te.element_id = a.figure_element_id
join public.technical_evaluation_element_results er on er.template_element_id = te.id
where er.evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000001' and er.result_status = 'meets';

-- Evaluación de hoy (desde Hoy, con invitación y reserva). Lo que no cumplió en la plantilla
-- vuelve a estar en la plantilla; lo que no cumplió en su parte personalizada vuelve como pendiente.
insert into public.technical_evaluations (id, studio_id, student_id, discipline_id, target_discipline_level_id, template_version_id, evaluation_date, evaluation_invitation_id)
select 'aaaaaaaa-0000-4000-8000-000000000002', t.studio_id, '33333333-0000-4000-8000-0000000000b1', t.discipline_id,
       t.discipline_technical_level_id, v.id, current_date, '99999999-0000-4000-8000-000000000001'
from public.evaluation_templates t join public.evaluation_template_versions v on v.template_id = t.id
where t.discipline_technical_level_id = '55555555-0000-4000-8000-000000000001';

select pi.reason, pi.sort_order, p.slug, p.catalog_level
from public.technical_evaluation_personal_items pi
join public.pole_figure_profiles p on p.element_id = pi.element_id
where pi.evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000002'
order by pi.sort_order;

-- Ninguna figura personalizada repite una de la plantilla.
select count(*) as overlap_with_template
from public.technical_evaluation_personal_items pi
join public.technical_evaluations e on e.id = pi.evaluation_id
join public.evaluation_template_elements te on te.template_version_id = e.template_version_id and te.element_id = pi.element_id
where pi.evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000002';

-- 3) Calificar como instructora y publicar.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select public.staff_save_evaluation_personal_item(pi.id, 'meets', 1, 'Limpia') ->> 'ok' as saved
from public.technical_evaluation_personal_items pi
where pi.evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000002' and pi.reason in ('self_marked','next_level')
order by pi.sort_order limit 2;
select public.staff_refresh_evaluation_personal_items('aaaaaaaa-0000-4000-8000-000000000002') as regenerated_after_refresh;
select count(*) as items_after_refresh,
       count(*) filter (where result_status = 'meets') as still_meets
from public.technical_evaluation_personal_items where evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000002';
reset role;

update public.technical_evaluations set status = 'published', final_outcome = 'approved', published_at = now()
where id = 'aaaaaaaa-0000-4000-8000-000000000002';

select p.slug, a.source, a.validated_at is not null as validated, a.class_session_id is not null as with_session
from public.technical_evaluation_personal_items pi
join public.pole_figure_profiles p on p.element_id = pi.element_id
join public.student_pole_figure_achievements a on a.figure_element_id = pi.element_id and a.student_id = '33333333-0000-4000-8000-0000000000b1'
where pi.evaluation_id = 'aaaaaaaa-0000-4000-8000-000000000002' and pi.result_status = 'meets'
order by p.slug;


-- Assertions: an unexpected success, wrong denial or missing fixture fails psql.
create function pg_temp.assert_true(p_ok boolean,p_label text) returns void
language plpgsql as $$ begin
 if p_ok is distinct from true then raise exception 'assertion_failed: %',p_label; end if;
 raise notice 'PASS: %',p_label;
end $$;
create function pg_temp.expect_error(p_sql text,p_expected text) returns void
language plpgsql as $$ begin
 begin execute p_sql;
 exception when others then
  if sqlerrm = p_expected then raise notice 'PASS: denied %',p_expected; return; end if;
  raise;
 end;
 raise exception 'expected_error_not_raised: %',p_expected;
end $$;
select pg_temp.assert_true((select count(*)=5 from public.evaluation_templates),'five templates');
select pg_temp.assert_true((select count(*)=5 from public.evaluation_template_versions where status='active'),'active templates');
select pg_temp.assert_true(not exists(select 1 from public.evaluation_template_elements a
 join public.evaluation_template_elements b on a.element_id=b.element_id and a.id<>b.id),'no duplicate figures between levels');
select pg_temp.assert_true(not exists(select 1 from public.evaluation_template_elements t
 join public.pole_figure_profiles p on p.element_id=t.element_id where p.catalog_level='profesional'),'no professional figures');
select pg_temp.assert_true(not exists(select 1 from public.technical_evaluation_personal_items p
 join public.technical_evaluations e on e.id=p.evaluation_id
 join public.evaluation_template_elements t on t.template_version_id=e.template_version_id and t.element_id=p.element_id),'no template/personal overlap');
select pg_temp.assert_true(not exists(select 1 from public.technical_evaluation_personal_items
 group by evaluation_id,reason having count(*)>3),'refresh respects three figures per group');
select pg_temp.assert_true((select count(*)=2 from public.technical_evaluation_personal_items
 where evaluation_id='aaaaaaaa-0000-4000-8000-000000000002' and result_status='meets'),'refresh preserved scored items');
select pg_temp.assert_true(not exists(select 1 from public.technical_evaluation_personal_items p
 left join public.student_pole_figure_achievements a on a.figure_element_id=p.element_id
  and a.student_id='33333333-0000-4000-8000-0000000000b1'
 where p.evaluation_id='aaaaaaaa-0000-4000-8000-000000000002' and p.result_status='meets'
 and (a.id is null or a.source<>'instructor' or a.validated_at is null or a.class_session_id is null)),
 'publication proposal validates canonical achievements and preserves session');
select pg_temp.assert_true((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='public.technical_evaluation_personal_items'::regclass),'forced RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.technical_evaluation_personal_items','UPDATE'), 'no direct updates');
select pg_temp.assert_true(not has_function_privilege('anon','public.staff_save_evaluation_personal_item(uuid,text,integer,text)','EXECUTE'), 'no anonymous RPC');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.expect_error(
 $$select public.staff_save_evaluation_personal_item((select id from public.technical_evaluation_personal_items where evaluation_id='aaaaaaaa-0000-4000-8000-000000000002' limit 1),'meets')$$,
 'evaluation_not_editable');
select pg_temp.expect_error($$select public.staff_refresh_evaluation_personal_items('aaaaaaaa-0000-4000-8000-000000000002')$$,'evaluation_not_editable');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.expect_error($$select public.admin_seed_pole_evaluation_templates('22222222-2222-4222-8222-222222222222')$$,'evaluation_access_denied');
select pg_temp.assert_true((select count(*)=0 from public.technical_evaluation_personal_items),'student cannot read private items');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select pg_temp.assert_true((select count(*)=0 from public.technical_evaluation_personal_items),'outsider cannot read private items');
reset role;
