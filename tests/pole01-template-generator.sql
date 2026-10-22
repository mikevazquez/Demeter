-- POLE-01-13 · SQL checks for the level template generator (local PostgreSQL only).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.studios(id, name) values ('10000000-0000-0000-0000-000000000001', 'Estudio prueba');
insert into public.disciplines(id, studio_id, name)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Pole Fitness');
insert into public.studio_memberships(studio_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'instructor');
insert into public.technical_level_definitions(studio_id, level_key, title, level_order)
select '10000000-0000-0000-0000-000000000001', k, t, o
from (values ('beginner','Principiante',1),('intermediate','Intermedio',2),
             ('upper_intermediate','Intermedio Avanzado',3),('advanced','Avanzado',4),('elite','Élite',5)) v(k,t,o);
insert into public.discipline_technical_levels(studio_id, discipline_id, technical_level_id, discipline_order)
select studio_id, '20000000-0000-0000-0000-000000000001', id, level_order
from public.technical_level_definitions where studio_id = '10000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.staff_seed_pole_catalog('10000000-0000-0000-0000-000000000001');
select public.staff_propose_pole_mandatory_figures('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

do $$
declare
  s uuid := '10000000-0000-0000-0000-000000000001';
  d uuid := '20000000-0000-0000-0000-000000000001';
  r jsonb;
  v uuid;
  f uuid;
begin
  -- G1: nothing is generated while proposals are pending.
  r := public.staff_generate_pole_evaluation_templates(s, d);
  if (select count(*) from jsonb_each(r) where value->>'status' = 'mandatory_not_approved') <> 4 then raise exception 'G1 %', r; end if;
  if exists (select 1 from public.evaluation_template_versions) then raise exception 'G1_created'; end if;

  -- Approve beginner and intermediate only.
  for f in select figure_element_id from public.pole_level_mandatory_figures where studio_id = s and level_key in ('beginner','intermediate') loop
    perform public.staff_set_pole_mandatory_figure(s, d,
      (select level_key from public.pole_level_mandatory_figures where studio_id = s and figure_element_id = f), f, 'approved');
  end loop;

  -- G2: two levels generated and active, the rest still waiting.
  r := public.staff_generate_pole_evaluation_templates(s, d);
  if r->'beginner'->>'status' <> 'generated' or r->'intermediate'->>'status' <> 'generated'
     or r->'upper_intermediate'->>'status' <> 'mandatory_not_approved' then raise exception 'G2 %', r; end if;
  v := (r->'beginner'->>'template_version_id')::uuid;
  if (select status from public.evaluation_template_versions where id = v) <> 'active' then raise exception 'G2_active'; end if;
  if (select pass_threshold from public.evaluation_template_versions where id = v) <> 85 then raise exception 'G2_threshold'; end if;

  -- G3: three blocks 40/30/30 with the approved structure.
  if (select string_agg(criterion_key || ':' || block_type || ':' || weight_percent::int, ',' order by sort_order)
      from public.evaluation_template_criteria where template_version_id = v)
     <> 'pole_combo:weighted_criteria:40,pole_mandatory:meets:30,pole_nomenclature:correct_incorrect:30'
  then raise exception 'G3_blocks'; end if;
  if (select count(*) from public.evaluation_template_elements e join public.evaluation_template_criteria c on c.id = e.criterion_id
      where c.template_version_id = v and c.criterion_key = 'pole_combo' and e.item_weight_percent = 25 and e.max_score = 10) <> 4
  then raise exception 'G3_combo'; end if;
  if (select string_agg(e.item_label, ',' order by e.sort_order) from public.evaluation_template_elements e
      join public.evaluation_template_criteria c on c.id = e.criterion_id where c.template_version_id = v and c.criterion_key = 'pole_combo')
     <> 'Fuerza,Flexibilidad,Técnica,Líneas' then raise exception 'G3_criteria'; end if;
  if (select count(*) from public.evaluation_template_elements e join public.evaluation_template_criteria c on c.id = e.criterion_id
      where c.template_version_id = v and c.criterion_key = 'pole_mandatory' and e.progression_required and e.mandatory and not e.scored)
     <> (select count(*) from public.pole_level_mandatory_figures where studio_id = s and level_key = 'beginner')
  then raise exception 'G3_mandatory'; end if;
  if (select count(*) from public.evaluation_template_elements e join public.evaluation_template_criteria c on c.id = e.criterion_id
      where c.template_version_id = v and c.criterion_key = 'pole_nomenclature' and e.item_kind = 'question') <> 3
  then raise exception 'G3_nomenclature'; end if;

  -- G4: regenerating without changes keeps the same version.
  r := public.staff_generate_pole_evaluation_templates(s, d);
  if r->'beginner'->>'status' <> 'unchanged' or (r->'beginner'->>'template_version_id')::uuid <> v then raise exception 'G4 %', r; end if;

  -- G5: changing the minimum creates version 2, archives version 1, same template.
  perform public.staff_set_pole_level_minimum(s, d, 'beginner', 86);
  r := public.staff_generate_pole_evaluation_templates(s, d);
  if r->'beginner'->>'status' <> 'generated' or (r->'beginner'->>'version_number')::int <> 2 then raise exception 'G5 %', r; end if;
  if (select status from public.evaluation_template_versions where id = v) <> 'archived' then raise exception 'G5_archived'; end if;
  if (select count(distinct template_id) from public.pole_generated_templates where studio_id = s and level_key = 'beginner') <> 1 then raise exception 'G5_template'; end if;

  -- G6: rubric elements are reused, not duplicated.
  if (select count(*) from public.technical_elements where studio_id = s and name like 'Combo · %') <> 4
     or (select count(*) from public.technical_elements where studio_id = s and name like 'Figura dictada %') <> 3
  then raise exception 'G6_rubric'; end if;
end $$;

-- G7: an instructor cannot generate.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$
begin
  perform public.staff_generate_pole_evaluation_templates('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  raise exception 'G7_accepted';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end $$;

select 'passed' as result, 7 as controls;
rollback;
