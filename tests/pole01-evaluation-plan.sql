-- POLE-01-14 · SQL checks for the per-evaluation combo/dictation plan (local PostgreSQL only).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000c3');
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
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Alumna principiante'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Alumna élite');
insert into public.technical_evaluations(id, studio_id, student_id, discipline_id, current_discipline_level_id_at_start)
select ('40000000-0000-0000-0000-00000000000' || n)::uuid, '10000000-0000-0000-0000-000000000001', s,
  '20000000-0000-0000-0000-000000000001', dl.id
from (values (1, '30000000-0000-0000-0000-000000000001'::uuid, 'beginner'), (2, '30000000-0000-0000-0000-000000000002'::uuid, 'elite')) v(n, s, k)
join public.technical_level_definitions d on d.level_key = v.k
join public.discipline_technical_levels dl on dl.technical_level_id = d.id;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.staff_seed_pole_catalog('10000000-0000-0000-0000-000000000001');
select public.staff_propose_pole_mandatory_figures('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

do $$
declare
  beginner uuid := '40000000-0000-0000-0000-000000000001';
  elite uuid := '40000000-0000-0000-0000-000000000002';
  p public.pole_evaluation_figure_plans;
  mandatory uuid;
  figure uuid;
  ok uuid[];
begin
  -- P1: 4 + 3 distinct figures of the student's catalog level, none mandatory.
  perform public.staff_propose_pole_evaluation_plan(beginner);
  select * into p from public.pole_evaluation_figure_plans where evaluation_id = beginner;
  if p.catalog_level <> 'principiante' or cardinality(p.combo_figure_ids) <> 4 or cardinality(p.dictated_figure_ids) <> 3 then raise exception 'P1_shape'; end if;
  if (select count(distinct x) from unnest(p.combo_figure_ids || p.dictated_figure_ids) x) <> 7 then raise exception 'P1_distinct'; end if;
  if exists (select 1 from unnest(p.combo_figure_ids || p.dictated_figure_ids) x
             join public.pole_figure_profiles f on f.element_id = x where f.catalog_level <> 'principiante') then raise exception 'P1_level'; end if;
  if exists (select 1 from public.pole_level_mandatory_figures m where m.level_key = 'beginner'
             and m.figure_element_id = any(p.combo_figure_ids || p.dictated_figure_ids)) then raise exception 'P1_mandatory'; end if;

  -- P2: the coach can change figures; mandatory or repeated figures are rejected.
  select figure_element_id into mandatory from public.pole_level_mandatory_figures where level_key = 'beginner' limit 1;
  begin
    perform public.staff_set_pole_evaluation_plan(beginner, array[mandatory] || p.combo_figure_ids[2:4], p.dictated_figure_ids);
    raise exception 'P2_mandatory_accepted';
  exception when others then if sqlerrm <> 'pole_plan_invalid' then raise; end if; end;
  begin
    perform public.staff_set_pole_evaluation_plan(beginner, p.combo_figure_ids, array[p.combo_figure_ids[1]] || p.dictated_figure_ids[2:3]);
    raise exception 'P2_repeat_accepted';
  exception when others then if sqlerrm <> 'pole_plan_invalid' then raise; end if; end;
  select array_agg(x) into ok from (select x from unnest(p.combo_figure_ids) x order by x desc) s;
  perform public.staff_set_pole_evaluation_plan(beginner, ok, p.dictated_figure_ids);

  -- P3: starting freezes the plan.
  perform public.staff_start_pole_evaluation_plan(beginner);
  begin
    perform public.staff_set_pole_evaluation_plan(beginner, p.combo_figure_ids, p.dictated_figure_ids);
    raise exception 'P3_changed_after_start';
  exception when others then if sqlerrm <> 'pole_plan_locked' then raise; end if; end;

  -- P4: Élite proposes Profesional figures and needs each confirmed before starting.
  perform public.staff_propose_pole_evaluation_plan(elite);
  select * into p from public.pole_evaluation_figure_plans where evaluation_id = elite;
  if p.catalog_level <> 'profesional' then raise exception 'P4_level'; end if;
  begin
    perform public.staff_start_pole_evaluation_plan(elite);
    raise exception 'P4_started_without_confirmation';
  exception when others then if sqlerrm <> 'pole_plan_confirmation_required' then raise; end if; end;
  foreach figure in array p.combo_figure_ids || p.dictated_figure_ids loop
    perform public.staff_confirm_pole_plan_figure(elite, figure, true);
  end loop;
  perform public.staff_start_pole_evaluation_plan(elite);
  if (select locked_at from public.pole_evaluation_figure_plans where evaluation_id = elite) is null then raise exception 'P4_lock'; end if;
end $$;

-- P5: someone without access cannot propose.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
do $$
begin
  perform public.staff_propose_pole_evaluation_plan('40000000-0000-0000-0000-000000000001');
  raise exception 'P5_accepted';
exception when others then if sqlerrm <> 'forbidden' then raise; end if;
end $$;

select 'passed' as result, 5 as controls;
rollback;
