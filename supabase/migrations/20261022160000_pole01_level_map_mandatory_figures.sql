-- POLE-01-08 · POLE-01-09 · POLE-01-10
-- Decisiones de Mike (22-oct-2026), canónicas en Notion (épica POLE-01):
--  * Correspondencia nivel de alumna → nivel del catálogo, guardada por estudio:
--      beginner → principiante · intermediate → intermedio · upper_intermediate → intermedio
--      advanced → avanzado · elite → profesional
--  * Mínimo para subir desde cada nivel: P→I 85 · I→IA 87 · IA→A 90 · A→Élite 92 (Élite no sube).
--  * 4–5 figuras obligatorias por nivel de alumna: llave del siguiente nivel. El sistema las
--    propone y Mike las aprueba; sólo las aprobadas cuentan para la evaluación.
-- Las evaluaciones congelan su plantilla al iniciar, así que estos cambios no alteran
-- evaluaciones iniciadas ni publicadas.

-- disciplines(studio_id,id) must be unique for the composite foreign key below.
create unique index if not exists pole_disciplines_studio_id_uq on public.disciplines(studio_id, id);

create table if not exists public.pole_level_settings (
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null,
  level_key text not null
    check (level_key in ('beginner','intermediate','upper_intermediate','advanced','elite')),
  catalog_level text not null
    check (catalog_level in ('principiante','intermedio','avanzado','profesional')),
  min_score_to_advance numeric(5,2)
    check (min_score_to_advance is null or (min_score_to_advance > 0 and min_score_to_advance <= 100)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (studio_id, discipline_id, level_key),
  foreign key (studio_id, discipline_id) references public.disciplines(studio_id, id) on delete cascade,
  check ((level_key = 'elite') = (min_score_to_advance is null))
);

create table if not exists public.pole_level_mandatory_figures (
  studio_id uuid not null,
  discipline_id uuid not null,
  level_key text not null,
  figure_element_id uuid not null,
  status text not null default 'proposed' check (status in ('proposed','approved')),
  unlocks_count integer not null default 0 check (unlocks_count >= 0),
  proposed_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  primary key (studio_id, discipline_id, level_key, figure_element_id),
  foreign key (studio_id, discipline_id, level_key)
    references public.pole_level_settings(studio_id, discipline_id, level_key) on delete cascade,
  foreign key (studio_id, figure_element_id)
    references public.pole_figure_profiles(studio_id, element_id) on delete cascade,
  check ((status = 'approved') = (approved_at is not null)),
  check (level_key <> 'elite')
);

create index if not exists pole_level_mandatory_figure_idx
  on public.pole_level_mandatory_figures (studio_id, figure_element_id);

-- A mandatory figure must belong to the catalog level mapped to that student level.
create or replace function private.pole_mandatory_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.pole_level_settings s
    join public.pole_figure_profiles f
      on f.studio_id = s.studio_id and f.discipline_id = s.discipline_id
    join public.technical_elements e on e.id = f.element_id
    where s.studio_id = new.studio_id
      and s.discipline_id = new.discipline_id
      and s.level_key = new.level_key
      and f.element_id = new.figure_element_id
      and f.catalog_level = s.catalog_level
      and e.active
  ) then
    raise exception 'pole_mandatory_level_mismatch';
  end if;
  return new;
end;
$$;
revoke all on function private.pole_mandatory_guard() from public, anon, authenticated;

drop trigger if exists pole_mandatory_guard on public.pole_level_mandatory_figures;
create trigger pole_mandatory_guard
  before insert or update on public.pole_level_mandatory_figures
  for each row execute function private.pole_mandatory_guard();

-- Defaults are created per studio and Pole discipline; existing rows are never overwritten.
create or replace function private.pole_ensure_level_settings(p_studio uuid, p_discipline uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pole_level_settings (studio_id, discipline_id, level_key, catalog_level, min_score_to_advance)
  values
    (p_studio, p_discipline, 'beginner', 'principiante', 85),
    (p_studio, p_discipline, 'intermediate', 'intermedio', 87),
    (p_studio, p_discipline, 'upper_intermediate', 'intermedio', 90),
    (p_studio, p_discipline, 'advanced', 'avanzado', 92),
    (p_studio, p_discipline, 'elite', 'profesional', null)
  on conflict (studio_id, discipline_id, level_key) do nothing;
$$;
revoke all on function private.pole_ensure_level_settings(uuid, uuid) from public, anon, authenticated;

-- Catalog level for a student in a discipline, through the studio mapping.
create or replace function private.pole_student_catalog_level(p_student uuid, p_discipline uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.catalog_level
  from public.pole_level_settings s
  join public.students st on st.id = p_student and st.studio_id = s.studio_id
  where s.discipline_id = p_discipline
    and s.level_key = private.pole_level(p_student, p_discipline);
$$;
revoke all on function private.pole_student_catalog_level(uuid, uuid) from public, anon, authenticated;

-- POLE-01-10 · Proposal: core, active, non-professional figures of the mapped catalog level that
-- are prerequisites of figures in the next step, ranked by how many figures they unlock.
--  * intermediate unlocks the rest of «intermedio» (shared with upper_intermediate);
--  * upper_intermediate unlocks «avanzado» and excludes figures already proposed for intermediate;
--  * beginner unlocks «intermedio»; advanced unlocks «profesional».
-- Approved figures are kept; only unapproved proposals are replaced.
create or replace function private.pole_propose_mandatory(p_studio uuid, p_discipline uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level record;
  v_next text;
  v_count integer;
  v_result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not private.has_capability(p_studio, 'evaluations.configure') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.disciplines where id = p_discipline and studio_id = p_studio) then
    raise exception 'forbidden';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pole_mandatory:' || p_studio::text || ':' || p_discipline::text, 0)
  );
  perform private.pole_ensure_level_settings(p_studio, p_discipline);

  for v_level in
    select s.level_key, s.catalog_level
    from public.pole_level_settings s
    where s.studio_id = p_studio and s.discipline_id = p_discipline and s.level_key <> 'elite'
    order by array_position(array['beginner','intermediate','upper_intermediate','advanced'], s.level_key)
  loop
    v_next := case v_level.level_key
      when 'beginner' then 'intermedio'
      when 'intermediate' then 'intermedio'
      when 'upper_intermediate' then 'avanzado'
      when 'advanced' then 'profesional'
    end;

    delete from public.pole_level_mandatory_figures m
    where m.studio_id = p_studio and m.discipline_id = p_discipline
      and m.level_key = v_level.level_key and m.status = 'proposed';

    select count(*) into v_count
    from public.pole_level_mandatory_figures m
    where m.studio_id = p_studio and m.discipline_id = p_discipline
      and m.level_key = v_level.level_key;

    insert into public.pole_level_mandatory_figures
      (studio_id, discipline_id, level_key, figure_element_id, status, unlocks_count)
    select p_studio, p_discipline, v_level.level_key, ranked.element_id, 'proposed', ranked.unlocks
    from (
      select f.element_id, count(distinct target.element_id)::integer as unlocks, f.sort_order
      from public.pole_figure_profiles f
      join public.technical_elements e on e.id = f.element_id and e.active
      join public.pole_figure_prerequisites p
        on p.studio_id = f.studio_id and p.required_element_id = f.element_id
      join public.pole_figure_profiles target
        on target.studio_id = p.studio_id and target.element_id = p.figure_element_id
      where f.studio_id = p_studio
        and f.discipline_id = p_discipline
        and f.catalog_level = v_level.catalog_level
        and f.in_core_program
        and not f.requires_authorization
        and target.catalog_level = v_next
        and target.element_id <> f.element_id
        and not exists (
          select 1 from public.pole_level_mandatory_figures existing
          where existing.studio_id = p_studio and existing.discipline_id = p_discipline
            and existing.figure_element_id = f.element_id
            and (existing.level_key = v_level.level_key
              or (v_level.level_key = 'upper_intermediate' and existing.level_key = 'intermediate'))
        )
      group by f.element_id, f.sort_order
      order by unlocks desc, f.sort_order
      limit greatest(0, 5 - v_count)
    ) ranked;

    -- Fallback when the next step has too few keys (e.g. Avanzado → Profesional): figures that
    -- unlock others inside the same catalog level.
    select count(*) into v_count
    from public.pole_level_mandatory_figures m
    where m.studio_id = p_studio and m.discipline_id = p_discipline
      and m.level_key = v_level.level_key;

    if v_count < 4 then
      insert into public.pole_level_mandatory_figures
        (studio_id, discipline_id, level_key, figure_element_id, status, unlocks_count)
      select p_studio, p_discipline, v_level.level_key, ranked.element_id, 'proposed', ranked.unlocks
      from (
        select f.element_id, count(distinct target.element_id)::integer as unlocks, f.sort_order
        from public.pole_figure_profiles f
        join public.technical_elements e on e.id = f.element_id and e.active
        join public.pole_figure_prerequisites p
          on p.studio_id = f.studio_id and p.required_element_id = f.element_id
        join public.pole_figure_profiles target
          on target.studio_id = p.studio_id and target.element_id = p.figure_element_id
        where f.studio_id = p_studio
          and f.discipline_id = p_discipline
          and f.catalog_level = v_level.catalog_level
          and f.in_core_program
          and not f.requires_authorization
          and target.catalog_level = v_level.catalog_level
          and not exists (
            select 1 from public.pole_level_mandatory_figures existing
            where existing.studio_id = p_studio and existing.discipline_id = p_discipline
              and existing.figure_element_id = f.element_id
              and (existing.level_key = v_level.level_key
                or (v_level.level_key = 'upper_intermediate' and existing.level_key = 'intermediate'))
          )
        group by f.element_id, f.sort_order
        order by unlocks desc, f.sort_order
        limit greatest(0, 5 - v_count)
      ) ranked;
    end if;

    v_result := v_result || jsonb_build_object(
      v_level.level_key,
      (select count(*) from public.pole_level_mandatory_figures m
       where m.studio_id = p_studio and m.discipline_id = p_discipline and m.level_key = v_level.level_key)
    );
  end loop;

  return v_result;
end;
$$;
revoke all on function private.pole_propose_mandatory(uuid, uuid) from public, anon, authenticated;
grant execute on function private.pole_propose_mandatory(uuid, uuid) to authenticated;

-- Approve, keep as proposal or remove one figure (staff with evaluations.configure).
create or replace function private.pole_set_mandatory(
  p_studio uuid,
  p_discipline uuid,
  p_level_key text,
  p_figure uuid,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_capability(p_studio, 'evaluations.configure') then
    raise exception 'forbidden';
  end if;
  if p_state not in ('approved','proposed','removed') then
    raise exception 'pole_mandatory_state_invalid';
  end if;
  perform private.pole_ensure_level_settings(p_studio, p_discipline);

  if p_state = 'removed' then
    delete from public.pole_level_mandatory_figures
    where studio_id = p_studio and discipline_id = p_discipline
      and level_key = p_level_key and figure_element_id = p_figure;
    return;
  end if;

  insert into public.pole_level_mandatory_figures
    (studio_id, discipline_id, level_key, figure_element_id, status, approved_by, approved_at)
  values (
    p_studio, p_discipline, p_level_key, p_figure, p_state,
    case when p_state = 'approved' then auth.uid() end,
    case when p_state = 'approved' then now() end
  )
  on conflict (studio_id, discipline_id, level_key, figure_element_id) do update
    set status = excluded.status,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at;

  if (select count(*) from public.pole_level_mandatory_figures
      where studio_id = p_studio and discipline_id = p_discipline and level_key = p_level_key) > 5 then
    raise exception 'pole_mandatory_limit';
  end if;
end;
$$;
revoke all on function private.pole_set_mandatory(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function private.pole_set_mandatory(uuid, uuid, text, uuid, text) to authenticated;

-- Change the minimum for one step (never for Élite).
create or replace function private.pole_set_level_minimum(
  p_studio uuid,
  p_discipline uuid,
  p_level_key text,
  p_minimum numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_capability(p_studio, 'evaluations.configure') then
    raise exception 'forbidden';
  end if;
  if p_level_key = 'elite' or p_minimum is null or p_minimum <= 0 or p_minimum > 100 then
    raise exception 'pole_minimum_invalid';
  end if;
  perform private.pole_ensure_level_settings(p_studio, p_discipline);
  update public.pole_level_settings
  set min_score_to_advance = p_minimum, updated_by = auth.uid(), updated_at = now()
  where studio_id = p_studio and discipline_id = p_discipline and level_key = p_level_key;
end;
$$;
revoke all on function private.pole_set_level_minimum(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function private.pole_set_level_minimum(uuid, uuid, text, numeric) to authenticated;

-- Public invoker wrappers (same pattern as the rest of the Pole API).
create or replace function public.staff_propose_pole_mandatory_figures(p_studio uuid, p_discipline uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.pole_propose_mandatory(p_studio, p_discipline); $$;
revoke all on function public.staff_propose_pole_mandatory_figures(uuid, uuid) from public, anon;
grant execute on function public.staff_propose_pole_mandatory_figures(uuid, uuid) to authenticated;

create or replace function public.staff_set_pole_mandatory_figure(
  p_studio uuid, p_discipline uuid, p_level_key text, p_figure uuid, p_state text
)
returns void language sql security invoker set search_path = ''
as $$ select private.pole_set_mandatory(p_studio, p_discipline, p_level_key, p_figure, p_state); $$;
revoke all on function public.staff_set_pole_mandatory_figure(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.staff_set_pole_mandatory_figure(uuid, uuid, text, uuid, text) to authenticated;

create or replace function public.staff_set_pole_level_minimum(
  p_studio uuid, p_discipline uuid, p_level_key text, p_minimum numeric
)
returns void language sql security invoker set search_path = ''
as $$ select private.pole_set_level_minimum(p_studio, p_discipline, p_level_key, p_minimum); $$;
revoke all on function public.staff_set_pole_level_minimum(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.staff_set_pole_level_minimum(uuid, uuid, text, numeric) to authenticated;

-- Read access: staff with evaluations.read. Writes only through the functions above.
alter table public.pole_level_settings enable row level security;
alter table public.pole_level_settings force row level security;
revoke all on public.pole_level_settings from public, anon, authenticated;
grant select on public.pole_level_settings to authenticated;
drop policy if exists pole_level_settings_staff_read on public.pole_level_settings;
create policy pole_level_settings_staff_read on public.pole_level_settings
  for select to authenticated using (private.has_capability(studio_id, 'evaluations.read'));

alter table public.pole_level_mandatory_figures enable row level security;
alter table public.pole_level_mandatory_figures force row level security;
revoke all on public.pole_level_mandatory_figures from public, anon, authenticated;
grant select on public.pole_level_mandatory_figures to authenticated;
drop policy if exists pole_level_mandatory_figures_staff_read on public.pole_level_mandatory_figures;
create policy pole_level_mandatory_figures_staff_read on public.pole_level_mandatory_figures
  for select to authenticated using (private.has_capability(studio_id, 'evaluations.read'));

-- Defaults for every studio that already has the Pole catalog.
do $$
declare r record;
begin
  for r in select distinct studio_id, discipline_id from public.pole_figure_profiles loop
    perform private.pole_ensure_level_settings(r.studio_id, r.discipline_id);
  end loop;
end $$;
