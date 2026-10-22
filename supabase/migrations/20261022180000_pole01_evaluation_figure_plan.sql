-- POLE-01-14 · Figuras de cada evaluación: combo de 4 y dictado de 3.
-- Decisiones de Mike (22-oct-2026):
--  * Al iniciar, el sistema propone un combo de 4 figuras y un dictado de 3 figuras distintas,
--    del nivel de catálogo de la alumna y distintas de sus obligatorias.
--  * La coach puede cambiar figuras antes de empezar; al empezar el plan se congela.
--  * Élite: se proponen figuras Profesional y la coach confirma cada una en vivo antes de empezar.
-- El nivel se toma del nivel con el que se abrió la evaluación (current_discipline_level_id_at_start).

create table if not exists public.pole_evaluation_figure_plans (
  evaluation_id uuid primary key,
  studio_id uuid not null,
  level_key text not null
    check (level_key in ('beginner','intermediate','upper_intermediate','advanced','elite')),
  catalog_level text not null
    check (catalog_level in ('principiante','intermedio','avanzado','profesional')),
  combo_figure_ids uuid[] not null check (cardinality(combo_figure_ids) = 4),
  dictated_figure_ids uuid[] not null check (cardinality(dictated_figure_ids) = 3),
  confirmed_figure_ids uuid[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid references auth.users(id) on delete set null,
  foreign key (studio_id, evaluation_id) references public.technical_evaluations(studio_id, id) on delete cascade
);

create or replace function private.pole_plan_context(p_evaluation uuid)
returns table (studio_id uuid, discipline_id uuid, level_key text, catalog_level text, student_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.studio_id, e.discipline_id, d.level_key, s.catalog_level, e.student_id, e.status
  from public.technical_evaluations e
  join public.discipline_technical_levels dl
    on dl.id = e.current_discipline_level_id_at_start and dl.studio_id = e.studio_id
  join public.technical_level_definitions d on d.id = dl.technical_level_id and d.studio_id = dl.studio_id
  join public.pole_level_settings s
    on s.studio_id = e.studio_id and s.discipline_id = e.discipline_id and s.level_key = d.level_key
  where e.id = p_evaluation;
$$;
revoke all on function private.pole_plan_context(uuid) from public, anon, authenticated;

-- Figures that may appear in the combo or the dictation for a level.
create or replace function private.pole_plan_candidate(
  p_studio uuid, p_discipline uuid, p_level_key text, p_catalog_level text, p_figure uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pole_figure_profiles f
    join public.technical_elements e on e.id = f.element_id and e.active
    where f.studio_id = p_studio and f.discipline_id = p_discipline and f.element_id = p_figure
      and f.catalog_level = p_catalog_level
      and (f.in_core_program or p_catalog_level = 'profesional')
      and not exists (
        select 1 from public.pole_level_mandatory_figures m
        where m.studio_id = p_studio and m.discipline_id = p_discipline
          and m.level_key = p_level_key and m.figure_element_id = p_figure
      )
  );
$$;
revoke all on function private.pole_plan_candidate(uuid, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function private.pole_plan_propose(p_evaluation uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_picks uuid[];
begin
  select * into c from private.pole_plan_context(p_evaluation);
  if c.studio_id is null then raise exception 'pole_plan_not_pole_evaluation'; end if;
  if auth.uid() is null or not private.has_capability(c.studio_id, 'evaluations.write') then raise exception 'forbidden'; end if;
  if c.status <> 'draft' then raise exception 'pole_plan_locked'; end if;

  perform 1 from public.technical_evaluations where id = p_evaluation for update;
  if exists (select 1 from public.pole_evaluation_figure_plans where evaluation_id = p_evaluation and locked_at is not null) then
    raise exception 'pole_plan_locked';
  end if;

  select array_agg(f.element_id) into v_picks
  from (
    select f.element_id
    from public.pole_figure_profiles f
    where f.studio_id = c.studio_id and f.discipline_id = c.discipline_id
      and private.pole_plan_candidate(c.studio_id, c.discipline_id, c.level_key, c.catalog_level, f.element_id)
    order by random()
    limit 7
  ) f;

  if coalesce(cardinality(v_picks), 0) < 7 then raise exception 'pole_plan_not_enough_figures'; end if;

  insert into public.pole_evaluation_figure_plans (
    evaluation_id, studio_id, level_key, catalog_level, combo_figure_ids, dictated_figure_ids,
    confirmed_figure_ids, updated_by, updated_at
  )
  values (p_evaluation, c.studio_id, c.level_key, c.catalog_level, v_picks[1:4], v_picks[5:7], '{}', auth.uid(), now())
  on conflict (evaluation_id) do update
    set combo_figure_ids = excluded.combo_figure_ids,
        dictated_figure_ids = excluded.dictated_figure_ids,
        confirmed_figure_ids = '{}',
        level_key = excluded.level_key,
        catalog_level = excluded.catalog_level,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return jsonb_build_object('combo', to_jsonb(v_picks[1:4]), 'dictated', to_jsonb(v_picks[5:7]));
end;
$$;
revoke all on function private.pole_plan_propose(uuid) from public, anon, authenticated;
grant execute on function private.pole_plan_propose(uuid) to authenticated;

create or replace function private.pole_plan_set(p_evaluation uuid, p_combo uuid[], p_dictated uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_figure uuid;
  v_all uuid[] := coalesce(p_combo, '{}') || coalesce(p_dictated, '{}');
  v_previous uuid[];
begin
  select * into c from private.pole_plan_context(p_evaluation);
  if c.studio_id is null then raise exception 'pole_plan_not_pole_evaluation'; end if;
  if auth.uid() is null or not private.has_capability(c.studio_id, 'evaluations.write') then raise exception 'forbidden'; end if;
  if c.status <> 'draft' then raise exception 'pole_plan_locked'; end if;

  perform 1 from public.technical_evaluations where id = p_evaluation for update;
  if exists (select 1 from public.pole_evaluation_figure_plans where evaluation_id = p_evaluation and locked_at is not null) then
    raise exception 'pole_plan_locked';
  end if;

  if cardinality(p_combo) <> 4 or cardinality(p_dictated) <> 3
     or (select count(distinct x) from unnest(v_all) x) <> 7 then
    raise exception 'pole_plan_invalid';
  end if;
  foreach v_figure in array v_all loop
    if not private.pole_plan_candidate(c.studio_id, c.discipline_id, c.level_key, c.catalog_level, v_figure) then
      raise exception 'pole_plan_invalid';
    end if;
  end loop;

  select confirmed_figure_ids into v_previous from public.pole_evaluation_figure_plans where evaluation_id = p_evaluation;

  insert into public.pole_evaluation_figure_plans (
    evaluation_id, studio_id, level_key, catalog_level, combo_figure_ids, dictated_figure_ids,
    confirmed_figure_ids, updated_by, updated_at
  )
  values (
    p_evaluation, c.studio_id, c.level_key, c.catalog_level, p_combo, p_dictated,
    -- Keep confirmations only for figures still in the plan.
    coalesce((select array_agg(x) from unnest(coalesce(v_previous, '{}')) x where x = any(v_all)), '{}'),
    auth.uid(), now()
  )
  on conflict (evaluation_id) do update
    set combo_figure_ids = excluded.combo_figure_ids,
        dictated_figure_ids = excluded.dictated_figure_ids,
        confirmed_figure_ids = excluded.confirmed_figure_ids,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$$;
revoke all on function private.pole_plan_set(uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function private.pole_plan_set(uuid, uuid[], uuid[]) to authenticated;

-- Élite: the coach confirms each Profesional figure live before starting.
create or replace function private.pole_plan_confirm(p_evaluation uuid, p_figure uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare p public.pole_evaluation_figure_plans;
begin
  select * into p from public.pole_evaluation_figure_plans where evaluation_id = p_evaluation for update;
  if p.evaluation_id is null then raise exception 'pole_plan_missing'; end if;
  if auth.uid() is null or not private.has_capability(p.studio_id, 'evaluations.write') then raise exception 'forbidden'; end if;
  if p.locked_at is not null then raise exception 'pole_plan_locked'; end if;
  if not (p_figure = any(p.combo_figure_ids || p.dictated_figure_ids)) then raise exception 'pole_plan_invalid'; end if;

  update public.pole_evaluation_figure_plans
  set confirmed_figure_ids = case
        when p_confirmed then (select array_agg(distinct x) from unnest(confirmed_figure_ids || p_figure) x)
        else array_remove(confirmed_figure_ids, p_figure)
      end,
      updated_by = auth.uid(),
      updated_at = now()
  where evaluation_id = p_evaluation;
end;
$$;
revoke all on function private.pole_plan_confirm(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function private.pole_plan_confirm(uuid, uuid, boolean) to authenticated;

-- Start: freezes the plan. Élite requires every figure confirmed.
create or replace function private.pole_plan_lock(p_evaluation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare p public.pole_evaluation_figure_plans;
begin
  select * into p from public.pole_evaluation_figure_plans where evaluation_id = p_evaluation for update;
  if p.evaluation_id is null then raise exception 'pole_plan_missing'; end if;
  if auth.uid() is null or not private.has_capability(p.studio_id, 'evaluations.write') then raise exception 'forbidden'; end if;
  if p.locked_at is not null then return; end if;
  if p.level_key = 'elite' and exists (
    select 1 from unnest(p.combo_figure_ids || p.dictated_figure_ids) x where not (x = any(p.confirmed_figure_ids))
  ) then
    raise exception 'pole_plan_confirmation_required';
  end if;

  update public.pole_evaluation_figure_plans
  set locked_at = now(), locked_by = auth.uid()
  where evaluation_id = p_evaluation;
end;
$$;
revoke all on function private.pole_plan_lock(uuid) from public, anon, authenticated;
grant execute on function private.pole_plan_lock(uuid) to authenticated;

create or replace function public.staff_propose_pole_evaluation_plan(p_evaluation uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.pole_plan_propose(p_evaluation); $$;
create or replace function public.staff_set_pole_evaluation_plan(p_evaluation uuid, p_combo uuid[], p_dictated uuid[])
returns void language sql security invoker set search_path = ''
as $$ select private.pole_plan_set(p_evaluation, p_combo, p_dictated); $$;
create or replace function public.staff_confirm_pole_plan_figure(p_evaluation uuid, p_figure uuid, p_confirmed boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.pole_plan_confirm(p_evaluation, p_figure, p_confirmed); $$;
create or replace function public.staff_start_pole_evaluation_plan(p_evaluation uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.pole_plan_lock(p_evaluation); $$;

revoke all on function public.staff_propose_pole_evaluation_plan(uuid) from public, anon;
revoke all on function public.staff_set_pole_evaluation_plan(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.staff_confirm_pole_plan_figure(uuid, uuid, boolean) from public, anon;
revoke all on function public.staff_start_pole_evaluation_plan(uuid) from public, anon;
grant execute on function public.staff_propose_pole_evaluation_plan(uuid) to authenticated;
grant execute on function public.staff_set_pole_evaluation_plan(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.staff_confirm_pole_plan_figure(uuid, uuid, boolean) to authenticated;
grant execute on function public.staff_start_pole_evaluation_plan(uuid) to authenticated;

alter table public.pole_evaluation_figure_plans enable row level security;
alter table public.pole_evaluation_figure_plans force row level security;
revoke all on public.pole_evaluation_figure_plans from public, anon, authenticated;
grant select on public.pole_evaluation_figure_plans to authenticated;
drop policy if exists pole_evaluation_figure_plans_staff_read on public.pole_evaluation_figure_plans;
create policy pole_evaluation_figure_plans_staff_read on public.pole_evaluation_figure_plans
  for select to authenticated using (private.has_capability(studio_id, 'evaluations.read'));
