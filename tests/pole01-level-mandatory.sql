-- POLE-01-08/09/10 · SQL checks for level map, mandatory figures and minimums.
-- Run on a disposable local PostgreSQL after the Supabase test doubles and the Pole
-- migrations (domain, seed, integrity, C1, C2 fix, 20261022160000). Never on Sandbox/production.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');
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

do $$
declare
  s uuid := '10000000-0000-0000-0000-000000000001';
  d uuid := '20000000-0000-0000-0000-000000000001';
  r jsonb;
  f uuid;
  other uuid;
  n integer;
begin
  -- C1: proposal creates the default map and minimums.
  r := public.staff_propose_pole_mandatory_figures(s, d);
  if (select count(*) from public.pole_level_settings where studio_id = s) <> 5 then raise exception 'C1_settings'; end if;
  if (select string_agg(level_key || '=' || catalog_level || ':' || coalesce(min_score_to_advance::text, '-'), ',' order by level_key)
      from public.pole_level_settings where studio_id = s)
     <> 'advanced=avanzado:92.00,beginner=principiante:85.00,elite=profesional:-,intermediate=intermedio:87.00,upper_intermediate=intermedio:90.00'
  then raise exception 'C1_map'; end if;

  -- C2: 4–5 proposals for each of the 4 levels that can advance, all of the mapped catalog level, core and non-professional.
  for n in select count(*) from public.pole_level_mandatory_figures where studio_id = s group by level_key loop
    if n < 4 or n > 5 then raise exception 'C2_count %', n; end if;
  end loop;
  if (select count(distinct level_key) from public.pole_level_mandatory_figures where studio_id = s) <> 4 then
    raise exception 'C2_levels';
  end if;
  if exists (
    select 1 from public.pole_level_mandatory_figures m
    join public.pole_level_settings ls using (studio_id, discipline_id, level_key)
    join public.pole_figure_profiles p on p.element_id = m.figure_element_id
    where m.studio_id = s and (p.catalog_level <> ls.catalog_level or not p.in_core_program or p.requires_authorization)
  ) then raise exception 'C2_level'; end if;
  if exists (select 1 from public.pole_level_mandatory_figures where studio_id = s and (status <> 'proposed' or unlocks_count < 1)) then
    raise exception 'C2_status';
  end if;

  -- C3: Intermedio and Intermedio Avanzado never share a proposal.
  if exists (
    select figure_element_id from public.pole_level_mandatory_figures
    where studio_id = s and level_key in ('intermediate','upper_intermediate')
    group by figure_element_id having count(*) > 1
  ) then raise exception 'C3_shared'; end if;

  -- C4: approve one; re-proposing keeps it and replaces only proposals.
  select figure_element_id into f from public.pole_level_mandatory_figures
  where studio_id = s and level_key = 'beginner' order by unlocks_count desc limit 1;
  perform public.staff_set_pole_mandatory_figure(s, d, 'beginner', f, 'approved');
  r := public.staff_propose_pole_mandatory_figures(s, d);
  if (select status from public.pole_level_mandatory_figures where studio_id = s and level_key = 'beginner' and figure_element_id = f) <> 'approved'
  then raise exception 'C4_kept'; end if;
  if (select count(*) from public.pole_level_mandatory_figures where studio_id = s and level_key = 'beginner') > 5 then raise exception 'C4_limit'; end if;

  -- C5: a figure from another catalog level is rejected.
  select element_id into other from public.pole_figure_profiles p join public.technical_elements e on e.id = p.element_id
  where p.studio_id = s and p.catalog_level = 'avanzado' and e.active limit 1;
  begin
    perform public.staff_set_pole_mandatory_figure(s, d, 'beginner', other, 'approved');
    raise exception 'C5_accepted';
  exception when others then
    if sqlerrm <> 'pole_mandatory_level_mismatch' then raise; end if;
  end;

  -- C6: more than five per level is rejected.
  begin
    for other in
      select p.element_id from public.pole_figure_profiles p join public.technical_elements e on e.id = p.element_id
      where p.studio_id = s and p.catalog_level = 'principiante' and e.active
        and p.element_id not in (select figure_element_id from public.pole_level_mandatory_figures where studio_id = s and level_key = 'beginner')
      limit 6
    loop
      perform public.staff_set_pole_mandatory_figure(s, d, 'beginner', other, 'proposed');
    end loop;
    raise exception 'C6_accepted';
  exception when others then
    if sqlerrm <> 'pole_mandatory_limit' then raise; end if;
  end;

  -- C7: minimums editable except Élite.
  perform public.staff_set_pole_level_minimum(s, d, 'beginner', 86);
  if (select min_score_to_advance from public.pole_level_settings where studio_id = s and level_key = 'beginner') <> 86 then raise exception 'C7_min'; end if;
  begin
    perform public.staff_set_pole_level_minimum(s, d, 'elite', 95);
    raise exception 'C7_elite';
  exception when others then
    if sqlerrm <> 'pole_minimum_invalid' then raise; end if;
  end;
end $$;

-- C8: an instructor (no evaluations.configure) cannot change anything.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$
begin
  perform public.staff_set_pole_level_minimum('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'beginner', 50);
  raise exception 'C8_accepted';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end $$;

-- C9: direct writes are denied; reads are allowed to staff.
do $$
begin
  insert into public.pole_level_settings(studio_id, discipline_id, level_key, catalog_level, min_score_to_advance)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'beginner', 'principiante', 1);
  raise exception 'C9_write';
exception when insufficient_privilege then null;
end $$;
select count(*) = 5 as c9_read from public.pole_level_settings;

select 'passed' as result, 9 as controls;
rollback;
