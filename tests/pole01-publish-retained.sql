-- POLE-01-17/18 · Publish marks figures; retained promotion released in class (local PostgreSQL only).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.studios(id, name) values ('10000000-0000-0000-0000-000000000001', 'Estudio prueba');
insert into public.disciplines(id, studio_id, name)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Pole Fitness');
insert into public.studio_memberships(studio_id, user_id, role)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.technical_level_definitions(studio_id, level_key, title, level_order)
select '10000000-0000-0000-0000-000000000001', k, t, o
from (values ('beginner','Principiante',1),('intermediate','Intermedio',2),
             ('upper_intermediate','Intermedio Avanzado',3),('advanced','Avanzado',4),('elite','Élite',5)) v(k,t,o);
insert into public.discipline_technical_levels(studio_id, discipline_id, technical_level_id, discipline_order)
select studio_id, '20000000-0000-0000-0000-000000000001', id, level_order
from public.technical_level_definitions where studio_id = '10000000-0000-0000-0000-000000000001';
insert into public.students(id, studio_id, full_name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Alumna aprueba'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Alumna retenida');
insert into public.student_discipline_levels(studio_id, student_id, discipline_id, discipline_technical_level_id)
select '10000000-0000-0000-0000-000000000001', s.id, '20000000-0000-0000-0000-000000000001', dl.id
from public.students s, public.discipline_technical_levels dl
join public.technical_level_definitions d on d.id = dl.technical_level_id and d.level_key = 'beginner';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.staff_seed_pole_catalog('10000000-0000-0000-0000-000000000001');
select public.staff_propose_pole_mandatory_figures('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
select public.staff_set_pole_mandatory_figure('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  'beginner', figure_element_id, 'approved')
from public.pole_level_mandatory_figures where level_key = 'beginner';
select public.staff_generate_pole_evaluation_templates('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
reset role;

-- Two draft evaluations on the generated beginner template, with locked plans.
insert into public.technical_evaluations(id, studio_id, student_id, discipline_id, current_discipline_level_id_at_start, template_version_id, created_by)
select ('40000000-0000-0000-0000-00000000000' || n)::uuid, '10000000-0000-0000-0000-000000000001', s.id,
  '20000000-0000-0000-0000-000000000001', l.discipline_technical_level_id, g.template_version_id, '00000000-0000-0000-0000-0000000000a1'
from (values (1, '30000000-0000-0000-0000-000000000001'::uuid), (2, '30000000-0000-0000-0000-000000000002'::uuid)) v(n, sid)
join public.students s on s.id = v.sid
join public.student_discipline_levels l on l.student_id = s.id
join public.pole_generated_templates g on g.level_key = 'beginner';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.staff_propose_pole_evaluation_plan('40000000-0000-0000-0000-000000000001');
select public.staff_propose_pole_evaluation_plan('40000000-0000-0000-0000-000000000002');
select public.staff_start_pole_evaluation_plan('40000000-0000-0000-0000-000000000001');
select public.staff_start_pole_evaluation_plan('40000000-0000-0000-0000-000000000002');
reset role;

-- Results: evaluation 1 all meets; evaluation 2 all meets except the first mandatory figure.
insert into public.technical_evaluation_element_results(studio_id, evaluation_id, template_element_id, result_status)
select e.studio_id, e.id, te.id,
  case when e.id = '40000000-0000-0000-0000-000000000002' and c.criterion_key = 'pole_mandatory'
        and te.sort_order = (select min(x.sort_order) from public.evaluation_template_elements x where x.criterion_id = c.id)
       then 'does_not_meet' else 'meets' end
from public.technical_evaluations e
join public.evaluation_template_elements te on te.template_version_id = e.template_version_id
join public.evaluation_template_criteria c on c.id = te.criterion_id;
insert into public.technical_evaluation_criterion_results(studio_id, evaluation_id, template_criterion_id, score_percent, passed)
select e.studio_id, e.id, c.id, 100, true
from public.technical_evaluations e join public.evaluation_template_criteria c on c.template_version_id = e.template_version_id;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
reset role;
update public.technical_evaluations set status = 'published', final_outcome = 'approved', total_score = 100, published_at = now()
where id = '40000000-0000-0000-0000-000000000001';
update public.technical_evaluations set status = 'published', final_outcome = 'stays', total_score = 90, published_at = now()
where id = '40000000-0000-0000-0000-000000000002';

do $$
declare
  approved_student uuid := '30000000-0000-0000-0000-000000000001';
  retained_student uuid := '30000000-0000-0000-0000-000000000002';
  missing uuid;
  plan public.pole_evaluation_figure_plans;
  intermediate uuid;
begin
  -- R1: approved evaluation marks mandatory + dictated + combo figures (4 + 3 + all mandatory).
  select * into plan from public.pole_evaluation_figure_plans where evaluation_id = '40000000-0000-0000-0000-000000000001';
  if (select count(*) from public.student_pole_figure_achievements where student_id = approved_student)
     <> 7 + (select count(*) from public.pole_level_mandatory_figures where level_key = 'beginner') then raise exception 'R1_marks'; end if;
  if exists (select 1 from public.pole_retained_promotions where student_id = approved_student) then raise exception 'R1_retained'; end if;

  -- R2: score above minimum with one mandatory missing → retained, with that figure pending.
  if (select count(*) from public.pole_retained_promotions where student_id = retained_student and status = 'retained') <> 1 then raise exception 'R2_retained'; end if;
  select missing_figure_ids[1] into missing from public.pole_retained_promotions where student_id = retained_student;
  if (select cardinality(missing_figure_ids) from public.pole_retained_promotions where student_id = retained_student) <> 1 then raise exception 'R2_missing'; end if;
  if exists (select 1 from public.student_pole_figure_achievements where student_id = retained_student and figure_element_id = missing) then raise exception 'R2_marked_missing'; end if;

  -- R3: the coach marks it in class (real class RPC) → the student moves to Intermedio and the retention is released.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  perform public.set_student_pole_figure_achievement(retained_student, missing, true, null);
  reset role;
  select dl.id into intermediate from public.discipline_technical_levels dl
  join public.technical_level_definitions d on d.id = dl.technical_level_id where d.level_key = 'intermediate';
  if (select discipline_technical_level_id from public.student_discipline_levels where student_id = retained_student) <> intermediate then raise exception 'R3_level'; end if;
  if (select status from public.pole_retained_promotions where student_id = retained_student) <> 'released' then raise exception 'R3_status'; end if;
  if (select source_evaluation_id from public.student_discipline_levels where student_id = retained_student) <> '40000000-0000-0000-0000-000000000002' then raise exception 'R3_source'; end if;
end $$;

select 'passed' as result, 3 as controls;
rollback;
