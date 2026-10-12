-- POLE-FIGURAS-01 · Catálogo de figuras de Pole, progreso de alumna, combos por clase y
-- autorización de figuras Profesional.
--
-- Diseño:
-- * La figura de pole ES un public.technical_elements (element_kind = 'figure') de la
--   disciplina; pole_figure_profiles agrega los metadatos del catálogo (1:1). Así
--   Evaluaciones y este módulo comparten una sola biblioteca técnica.
-- * El nivel de la alumna viene de student_discipline_levels (Evaluaciones). Este módulo
--   no crea ni cambia niveles; sólo los traduce al nivel del catálogo con pole_level_map.
-- * Toda escritura de alumna o staff pasa por RPC security definer con validación de
--   reglas en servidor. Las tablas sólo exponen SELECT bajo RLS.
-- * El catálogo proviene de un libro de referencia: sólo se guardan nombres, nivel,
--   familia y página (visible únicamente para staff). Sin textos ni imágenes del libro.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.pole_figure_profiles (
  element_id uuid primary key references public.technical_elements(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  original_name text not null check (length(trim(original_name)) > 0),
  catalog_level text not null
    check (catalog_level in ('principiante', 'intermedio', 'avanzado', 'profesional')),
  figure_type text not null check (length(trim(figure_type)) > 0),
  family text not null check (length(trim(family)) > 0),
  in_core_program boolean not null default false,
  book_page smallint check (book_page is null or book_page > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, discipline_id, slug)
);

create index pole_figure_profiles_discipline_idx
on public.pole_figure_profiles (studio_id, discipline_id, catalog_level, sort_order);

create table public.pole_figure_prerequisites (
  studio_id uuid not null references public.studios(id) on delete cascade,
  figure_element_id uuid not null references public.pole_figure_profiles(element_id) on delete cascade,
  required_element_id uuid not null references public.pole_figure_profiles(element_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (figure_element_id, required_element_id),
  check (figure_element_id <> required_element_id)
);

create index pole_figure_prerequisites_required_idx
on public.pole_figure_prerequisites (required_element_id);

-- Traducción del nivel técnico del estudio (technical_level_definitions.level_key) al
-- nivel del catálogo. Si un estudio no tiene renglón para un level_key se usa el valor
-- por defecto de private.pole_default_catalog_level().
create table public.pole_level_map (
  studio_id uuid not null references public.studios(id) on delete cascade,
  level_key text not null check (level_key ~ '^[a-z0-9_]+$'),
  catalog_level text not null check (catalog_level in ('principiante', 'intermedio', 'avanzado')),
  pro_eligible boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (studio_id, level_key)
);

create table public.student_pole_achievements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  element_id uuid not null references public.pole_figure_profiles(element_id) on delete cascade,
  source text not null check (source in ('student', 'instructor')),
  marked_by uuid references auth.users(id) on delete set null,
  achieved_at timestamptz not null default now(),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  class_session_id uuid references public.class_sessions(id) on delete set null,
  photo_path text,
  updated_at timestamptz not null default now(),
  unique (student_id, element_id)
);

create index student_pole_achievements_student_idx
on public.student_pole_achievements (studio_id, student_id);

create table public.student_pole_authorizations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  element_id uuid not null references public.pole_figure_profiles(element_id) on delete cascade,
  authorized_by uuid references auth.users(id) on delete set null,
  authorized_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);

create unique index student_pole_authorizations_active_uq
on public.student_pole_authorizations (student_id, element_id)
where revoked_at is null;

create index student_pole_authorizations_student_idx
on public.student_pole_authorizations (studio_id, student_id);

create table public.pole_achievement_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  element_id uuid references public.pole_figure_profiles(element_id) on delete set null,
  event_type text not null check (
    event_type in ('marked', 'unmarked', 'validated', 'authorized', 'revoked', 'photo_set', 'photo_removed')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('student', 'staff')),
  class_session_id uuid references public.class_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index pole_achievement_events_student_idx
on public.pole_achievement_events (studio_id, student_id, created_at desc);

create table public.class_session_pole_plans (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  class_session_id uuid not null references public.class_sessions(id) on delete cascade,
  catalog_level text not null check (catalog_level in ('principiante', 'intermedio', 'avanzado')),
  element_ids uuid[] not null check (cardinality(element_ids) between 1 and 8),
  new_element_id uuid references public.pole_figure_profiles(element_id) on delete set null,
  student_ids uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_session_id, catalog_level)
);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (privadas)
-- ---------------------------------------------------------------------------

create or replace function private.pole_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.pole_level_rank(p_catalog_level text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_catalog_level
    when 'principiante' then 1
    when 'intermedio' then 2
    when 'avanzado' then 3
    when 'profesional' then 4
    else null
  end::smallint;
$$;

-- Mapeo acordado con el estudio (2026-10-12):
--   beginner                      -> principiante
--   intermediate, upper_intermediate -> intermedio
--   advanced, elite               -> avanzado  (+ elegibles para figuras Profesional)
create or replace function private.pole_default_catalog_level(p_level_key text)
returns table (catalog_level text, pro_eligible boolean)
language sql
immutable
set search_path = ''
as $$
  select
    case
      when p_level_key = 'beginner' then 'principiante'
      when p_level_key in ('intermediate', 'upper_intermediate') then 'intermedio'
      when p_level_key in ('advanced', 'elite') then 'avanzado'
      else null
    end,
    p_level_key in ('advanced', 'elite');
$$;

-- Nivel de catálogo vigente de una alumna en una disciplina.
create or replace function private.pole_student_level(
  p_studio_id uuid,
  p_student_id uuid,
  p_discipline_id uuid
)
returns table (level_key text, level_title text, catalog_level text, pro_eligible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tld.level_key,
    tld.title,
    coalesce(plm.catalog_level, d.catalog_level),
    coalesce(plm.pro_eligible, d.pro_eligible, false)
  from public.student_discipline_levels sdl
  join public.discipline_technical_levels dtl on dtl.id = sdl.discipline_technical_level_id
  join public.technical_level_definitions tld on tld.id = dtl.technical_level_id
  left join public.pole_level_map plm
    on plm.studio_id = sdl.studio_id and plm.level_key = tld.level_key
  left join lateral private.pole_default_catalog_level(tld.level_key) d on true
  where sdl.studio_id = p_studio_id
    and sdl.student_id = p_student_id
    and sdl.discipline_id = p_discipline_id
  limit 1;
$$;

-- Alumna del usuario autenticado (portal), o excepción.
create or replace function private.pole_current_student()
returns table (student_id uuid, studio_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select s.id, s.studio_id
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if not found then
    raise exception 'pole_student_not_found';
  end if;
end;
$$;

create or replace function private.pole_validate_prerequisite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_figure public.pole_figure_profiles;
  v_required public.pole_figure_profiles;
begin
  select * into v_figure from public.pole_figure_profiles where element_id = new.figure_element_id;
  select * into v_required from public.pole_figure_profiles where element_id = new.required_element_id;

  if v_figure.element_id is null or v_required.element_id is null then
    raise exception 'pole_prerequisite_figure_not_found';
  end if;

  if v_figure.studio_id <> new.studio_id
    or v_required.studio_id <> new.studio_id
    or v_figure.discipline_id <> v_required.discipline_id then
    raise exception 'pole_prerequisite_scope_mismatch';
  end if;

  -- Sin ciclos: la figura requerida no puede depender (directa o indirectamente) de la figura.
  if exists (
    with recursive chain(element_id) as (
      select p.required_element_id
      from public.pole_figure_prerequisites p
      where p.figure_element_id = new.required_element_id
      union
      select p.required_element_id
      from public.pole_figure_prerequisites p
      join chain c on p.figure_element_id = c.element_id
    )
    select 1 from chain where element_id = new.figure_element_id
  ) then
    raise exception 'pole_prerequisite_cycle';
  end if;

  return new;
end;
$$;

create or replace function private.pole_validate_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.technical_elements te
    where te.id = new.element_id
      and te.studio_id = new.studio_id
      and te.discipline_id = new.discipline_id
      and te.element_kind = 'figure'
  ) then
    raise exception 'pole_profile_element_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.pole_log_event(
  p_studio_id uuid,
  p_student_id uuid,
  p_element_id uuid,
  p_event_type text,
  p_actor_kind text,
  p_class_session_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pole_achievement_events
    (studio_id, student_id, element_id, event_type, actor_user_id, actor_kind, class_session_id)
  values
    (p_studio_id, p_student_id, p_element_id, p_event_type, (select auth.uid()), p_actor_kind, p_class_session_id);
$$;

-- ¿Puede esta alumna marcar esta figura? Devuelve null si sí, o el código del bloqueo.
create or replace function private.pole_mark_block_reason(
  p_studio_id uuid,
  p_student_id uuid,
  p_element_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.pole_figure_profiles;
  v_active boolean;
  v_level record;
begin
  select pfp.* into v_profile
  from public.pole_figure_profiles pfp
  where pfp.element_id = p_element_id and pfp.studio_id = p_studio_id;

  if v_profile.element_id is null then
    return 'pole_figure_not_found';
  end if;

  select te.active into v_active from public.technical_elements te where te.id = p_element_id;
  if not coalesce(v_active, false) then
    return 'pole_figure_inactive';
  end if;

  if v_profile.catalog_level = 'profesional' then
    if not exists (
      select 1 from public.student_pole_authorizations a
      where a.student_id = p_student_id
        and a.element_id = p_element_id
        and a.revoked_at is null
    ) then
      return 'pole_figure_requires_authorization';
    end if;
    return null;
  end if;

  select * into v_level
  from private.pole_student_level(p_studio_id, p_student_id, v_profile.discipline_id);

  -- Sin nivel asignado se trata como principiante.
  if private.pole_level_rank(v_profile.catalog_level)
     > private.pole_level_rank(coalesce(v_level.catalog_level, 'principiante')) then
    return 'pole_figure_next_level';
  end if;

  if exists (
    select 1
    from public.pole_figure_prerequisites p
    where p.figure_element_id = p_element_id
      and not exists (
        select 1 from public.student_pole_achievements a
        where a.student_id = p_student_id and a.element_id = p.required_element_id
      )
  ) then
    return 'pole_figure_prerequisites_missing';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger pole_figure_profiles_validate
before insert or update on public.pole_figure_profiles
for each row execute function private.pole_validate_profile();

create trigger pole_figure_profiles_touch
before update on public.pole_figure_profiles
for each row execute function private.pole_touch_updated_at();

create trigger pole_figure_prerequisites_validate
before insert or update on public.pole_figure_prerequisites
for each row execute function private.pole_validate_prerequisite();

create trigger pole_level_map_touch
before update on public.pole_level_map
for each row execute function private.pole_touch_updated_at();

create trigger student_pole_achievements_touch
before update on public.student_pole_achievements
for each row execute function private.pole_touch_updated_at();

create trigger class_session_pole_plans_touch
before update on public.class_session_pole_plans
for each row execute function private.pole_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPC · alumna
-- ---------------------------------------------------------------------------

-- Catálogo + progreso de la alumna autenticada para una disciplina con catálogo de pole.
-- Si p_discipline_id es null se usa la primera disciplina del estudio con catálogo.
-- No expone book_page.
create or replace function public.student_pole_figures(p_discipline_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_discipline_id uuid;
  v_discipline_name text;
  v_level record;
begin
  select * into v_student from private.pole_current_student();

  select d.id, d.name into v_discipline_id, v_discipline_name
  from public.disciplines d
  where d.studio_id = v_student.studio_id
    and (p_discipline_id is null or d.id = p_discipline_id)
    and exists (
      select 1 from public.pole_figure_profiles pfp
      where pfp.discipline_id = d.id and pfp.studio_id = d.studio_id
    )
  order by d.name
  limit 1;

  if v_discipline_id is null then
    return jsonb_build_object('discipline', null, 'level', null, 'figures', '[]'::jsonb);
  end if;

  select * into v_level
  from private.pole_student_level(v_student.studio_id, v_student.student_id, v_discipline_id);

  return jsonb_build_object(
    'student_id', v_student.student_id,
    'discipline', jsonb_build_object('id', v_discipline_id, 'name', v_discipline_name),
    'level', case when v_level.level_key is null then null else jsonb_build_object(
      'key', v_level.level_key,
      'title', v_level.level_title,
      'catalog_level', v_level.catalog_level,
      'pro_eligible', v_level.pro_eligible
    ) end,
    'figures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pfp.element_id,
        'slug', pfp.slug,
        'name', te.name,
        'original_name', pfp.original_name,
        'description', te.description,
        'level', pfp.catalog_level,
        'type', pfp.figure_type,
        'family', pfp.family,
        'core', pfp.in_core_program,
        'sort_order', pfp.sort_order,
        'prerequisites', coalesce((
          select jsonb_agg(p.required_element_id)
          from public.pole_figure_prerequisites p
          where p.figure_element_id = pfp.element_id
        ), '[]'::jsonb),
        'achievement', (
          select jsonb_build_object(
            'source', a.source,
            'achieved_at', a.achieved_at,
            'validated_at', a.validated_at,
            'class_session_id', a.class_session_id,
            'photo_path', a.photo_path
          )
          from public.student_pole_achievements a
          where a.student_id = v_student.student_id and a.element_id = pfp.element_id
        ),
        'authorized', exists (
          select 1 from public.student_pole_authorizations au
          where au.student_id = v_student.student_id
            and au.element_id = pfp.element_id
            and au.revoked_at is null
        )
      ) order by pfp.sort_order)
      from public.pole_figure_profiles pfp
      join public.technical_elements te on te.id = pfp.element_id
      where pfp.studio_id = v_student.studio_id
        and pfp.discipline_id = v_discipline_id
        and te.active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.student_mark_pole_figure(p_element_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_reason text;
  v_inserted boolean := false;
begin
  select * into v_student from private.pole_current_student();

  if exists (
    select 1 from public.student_pole_achievements
    where student_id = v_student.student_id and element_id = p_element_id
  ) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_reason := private.pole_mark_block_reason(v_student.studio_id, v_student.student_id, p_element_id);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  insert into public.student_pole_achievements
    (studio_id, student_id, element_id, source, marked_by)
  values
    (v_student.studio_id, v_student.student_id, p_element_id, 'student', (select auth.uid()))
  on conflict (student_id, element_id) do nothing;
  v_inserted := found;

  if v_inserted then
    perform private.pole_log_event(v_student.studio_id, v_student.student_id, p_element_id, 'marked', 'student');
  end if;

  return jsonb_build_object('ok', true, 'already', not v_inserted);
end;
$$;

-- Desmarca un logro propio (incluso si lo validó la instructora). No desmarca en cascada.
-- Devuelve la ruta de la foto que tenía, para que el cliente la borre de Storage.
create or replace function public.student_unmark_pole_figure(p_element_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_photo text;
  v_deleted boolean;
begin
  select * into v_student from private.pole_current_student();

  delete from public.student_pole_achievements
  where student_id = v_student.student_id and element_id = p_element_id
  returning photo_path into v_photo;
  v_deleted := found;

  if v_deleted then
    perform private.pole_log_event(v_student.studio_id, v_student.student_id, p_element_id, 'unmarked', 'student');
  end if;

  return jsonb_build_object('ok', true, 'removed', v_deleted, 'photo_path', v_photo);
end;
$$;

-- Asocia (o quita, con p_photo_path null) la foto de la alumna a una figura lograda.
-- La ruta debe vivir en su carpeta: {auth.uid()}/{element_id}/...
create or replace function public.student_set_pole_photo(p_element_id uuid, p_photo_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_previous text;
begin
  select * into v_student from private.pole_current_student();

  if p_photo_path is not null and (
    p_photo_path not like ((select auth.uid())::text || '/' || p_element_id::text || '/%')
    or p_photo_path like '%..%'
  ) then
    raise exception 'pole_photo_invalid_path';
  end if;

  select photo_path into v_previous
  from public.student_pole_achievements
  where student_id = v_student.student_id and element_id = p_element_id
  for update;

  if not found then
    raise exception 'pole_figure_not_achieved';
  end if;

  update public.student_pole_achievements
  set photo_path = p_photo_path
  where student_id = v_student.student_id and element_id = p_element_id;

  perform private.pole_log_event(
    v_student.studio_id, v_student.student_id, p_element_id,
    case when p_photo_path is null then 'photo_removed' else 'photo_set' end,
    'student'
  );

  return jsonb_build_object('ok', true, 'previous_photo_path', v_previous);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC · staff
-- ---------------------------------------------------------------------------

-- Guarda (o reemplaza) el combo elegido para un grupo de nivel en una sesión.
create or replace function public.staff_save_pole_plan(
  p_class_session_id uuid,
  p_catalog_level text,
  p_element_ids uuid[],
  p_new_element_id uuid,
  p_student_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_id uuid;
begin
  select cs.studio_id into v_studio_id from public.class_sessions cs where cs.id = p_class_session_id;
  if v_studio_id is null then
    raise exception 'pole_session_not_found';
  end if;
  perform private.evaluations_require_capability(v_studio_id, 'evaluations.write');

  if exists (
    select 1 from unnest(p_element_ids) e(id)
    where not exists (
      select 1 from public.pole_figure_profiles pfp
      where pfp.element_id = e.id
        and pfp.studio_id = v_studio_id
        and pfp.catalog_level <> 'profesional'
    )
  ) then
    raise exception 'pole_plan_invalid_figures';
  end if;

  if p_new_element_id is not null and not (p_new_element_id = any (p_element_ids)) then
    raise exception 'pole_plan_invalid_new_figure';
  end if;

  insert into public.class_session_pole_plans
    (studio_id, class_session_id, catalog_level, element_ids, new_element_id, student_ids, created_by)
  values
    (v_studio_id, p_class_session_id, p_catalog_level, p_element_ids, p_new_element_id,
     coalesce(p_student_ids, '{}'), (select auth.uid()))
  on conflict (class_session_id, catalog_level) do update
  set element_ids = excluded.element_ids,
      new_element_id = excluded.new_element_id,
      student_ids = excluded.student_ids,
      created_by = excluded.created_by
  returning id into v_id;

  return v_id;
end;
$$;

-- Valida al final de la clase las figuras logradas. p_items = [{student_id, element_id}].
create or replace function public.staff_validate_pole_figures(
  p_class_session_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_item jsonb;
  v_student_id uuid;
  v_element_id uuid;
  v_count integer := 0;
begin
  select cs.studio_id into v_studio_id from public.class_sessions cs where cs.id = p_class_session_id;
  if v_studio_id is null then
    raise exception 'pole_session_not_found';
  end if;
  perform private.evaluations_require_capability(v_studio_id, 'evaluations.write');

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'pole_validation_invalid_payload';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_student_id := (v_item ->> 'student_id')::uuid;
    v_element_id := (v_item ->> 'element_id')::uuid;

    if not exists (
      select 1 from public.reservations r
      where r.session_id = p_class_session_id
        and r.student_id = v_student_id
        and r.status::text in ('reserved', 'attended')
    ) then
      raise exception 'pole_validation_student_not_in_session';
    end if;

    if not exists (
      select 1 from public.pole_figure_profiles pfp
      where pfp.element_id = v_element_id and pfp.studio_id = v_studio_id
    ) then
      raise exception 'pole_figure_not_found';
    end if;

    insert into public.student_pole_achievements
      (studio_id, student_id, element_id, source, marked_by, validated_by, validated_at, class_session_id)
    values
      (v_studio_id, v_student_id, v_element_id, 'instructor', (select auth.uid()), (select auth.uid()), now(), p_class_session_id)
    on conflict (student_id, element_id) do update
    set source = 'instructor',
        validated_by = excluded.validated_by,
        validated_at = excluded.validated_at,
        class_session_id = excluded.class_session_id;

    perform private.pole_log_event(v_studio_id, v_student_id, v_element_id, 'validated', 'staff', p_class_session_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Autoriza o revoca una figura Profesional para una alumna avanzada.
create or replace function public.staff_set_pole_authorization(
  p_student_id uuid,
  p_element_id uuid,
  p_authorized boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.pole_figure_profiles;
  v_student_studio uuid;
  v_level record;
begin
  select * into v_profile from public.pole_figure_profiles where element_id = p_element_id;
  if v_profile.element_id is null then
    raise exception 'pole_figure_not_found';
  end if;
  perform private.evaluations_require_capability(v_profile.studio_id, 'evaluations.write');

  if v_profile.catalog_level <> 'profesional' then
    raise exception 'pole_authorization_not_professional';
  end if;

  select s.studio_id into v_student_studio from public.students s where s.id = p_student_id;
  if v_student_studio is distinct from v_profile.studio_id then
    raise exception 'pole_student_not_found';
  end if;

  if p_authorized then
    select * into v_level
    from private.pole_student_level(v_profile.studio_id, p_student_id, v_profile.discipline_id);
    if not coalesce(v_level.pro_eligible, false) then
      raise exception 'pole_authorization_student_not_eligible';
    end if;

    if not exists (
      select 1 from public.student_pole_authorizations
      where student_id = p_student_id and element_id = p_element_id and revoked_at is null
    ) then
      insert into public.student_pole_authorizations (studio_id, student_id, element_id, authorized_by)
      values (v_profile.studio_id, p_student_id, p_element_id, (select auth.uid()));
      perform private.pole_log_event(v_profile.studio_id, p_student_id, p_element_id, 'authorized', 'staff');
    end if;
  else
    update public.student_pole_authorizations
    set revoked_at = now(), revoked_by = (select auth.uid())
    where student_id = p_student_id and element_id = p_element_id and revoked_at is null;
    if found then
      perform private.pole_log_event(v_profile.studio_id, p_student_id, p_element_id, 'revoked', 'staff');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'authorized', p_authorized);
end;
$$;

-- Importa (idempotente, por slug) el catálogo base a una disciplina del estudio.
-- p_payload = { figuras: [...], combos_base: [...] } con el formato de
-- lib/pole/catalog-seed.json. Si ya existe un elemento técnico con el mismo nombre en la
-- disciplina, se reutiliza (una sola biblioteca con Evaluaciones).
create or replace function public.admin_import_pole_catalog(
  p_discipline_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_fig jsonb;
  v_slug text;
  v_name text;
  v_level text;
  v_active boolean;
  v_element_id uuid;
  v_existing_slug text;
  v_order integer := 0;
  v_figures integer := 0;
  v_prereqs integer := 0;
  v_combos integer := 0;
  v_combo jsonb;
  v_combo_id uuid;
  v_combo_name text;
  v_level_counter jsonb := '{}'::jsonb;
  v_pos integer;
  v_item text;
begin
  select d.studio_id into v_studio_id from public.disciplines d where d.id = p_discipline_id;
  if v_studio_id is null then
    raise exception 'pole_discipline_not_found';
  end if;
  perform private.evaluations_require_capability(v_studio_id, 'evaluations.configure');

  if jsonb_typeof(p_payload -> 'figuras') <> 'array' then
    raise exception 'pole_import_invalid_payload';
  end if;

  -- 1) Figuras
  for v_fig in select * from jsonb_array_elements(p_payload -> 'figuras')
  loop
    v_order := v_order + 1;
    v_slug := v_fig ->> 'slug';
    v_level := v_fig ->> 'nivel';
    v_active := v_level in ('principiante', 'intermedio', 'avanzado', 'profesional');
    if not v_active then
      v_level := 'avanzado';
    end if;
    v_name := coalesce(nullif(trim(v_fig ->> 'nombre_es'), ''), trim(v_fig ->> 'nombre_original'));

    select pfp.element_id into v_element_id
    from public.pole_figure_profiles pfp
    where pfp.studio_id = v_studio_id and pfp.discipline_id = p_discipline_id and pfp.slug = v_slug;

    if v_element_id is null then
      -- ¿Ya existe en la biblioteca técnica con ese nombre?
      select te.id, pfp.slug into v_element_id, v_existing_slug
      from public.technical_elements te
      left join public.pole_figure_profiles pfp on pfp.element_id = te.id
      where te.studio_id = v_studio_id
        and te.discipline_id = p_discipline_id
        and lower(te.name) = lower(v_name);

      if v_element_id is not null and v_existing_slug is not null then
        -- Nombre ocupado por otra figura del catálogo: desambiguar con "· 2", "· 3"…
        v_pos := 2;
        while exists (
          select 1 from public.technical_elements te
          where te.studio_id = v_studio_id and te.discipline_id = p_discipline_id
            and lower(te.name) = lower(v_name || ' · ' || v_pos)
        ) loop
          v_pos := v_pos + 1;
        end loop;
        v_name := v_name || ' · ' || v_pos;
        v_element_id := null;
      end if;

      if v_element_id is null then
        insert into public.technical_elements (studio_id, discipline_id, name, element_kind, active)
        values (v_studio_id, p_discipline_id, v_name, 'figure', v_active)
        returning id into v_element_id;
      else
        update public.technical_elements
        set element_kind = 'figure'
        where id = v_element_id and element_kind <> 'figure';
      end if;
    end if;

    insert into public.pole_figure_profiles
      (element_id, studio_id, discipline_id, slug, original_name, catalog_level, figure_type,
       family, in_core_program, book_page, sort_order)
    values
      (v_element_id, v_studio_id, p_discipline_id, v_slug, v_fig ->> 'nombre_original', v_level,
       coalesce(nullif(v_fig ->> 'tipo', ''), 'Figura'),
       coalesce(nullif(v_fig ->> 'familia', ''), 'Sin familia'),
       coalesce((v_fig ->> 'programa_base')::boolean, false),
       nullif(v_fig ->> 'pagina_libro', '')::smallint,
       v_order)
    on conflict (element_id) do update
    set original_name = excluded.original_name,
        catalog_level = excluded.catalog_level,
        figure_type = excluded.figure_type,
        family = excluded.family,
        in_core_program = excluded.in_core_program,
        book_page = excluded.book_page,
        sort_order = excluded.sort_order;

    v_figures := v_figures + 1;
  end loop;

  -- 2) Prerrequisitos (sólo se agregan; no se borran los que el estudio haya editado)
  for v_fig in select * from jsonb_array_elements(p_payload -> 'figuras')
  loop
    if jsonb_typeof(v_fig -> 'prerrequisitos') = 'array' then
      for v_item in select jsonb_array_elements_text(v_fig -> 'prerrequisitos')
      loop
        insert into public.pole_figure_prerequisites (studio_id, figure_element_id, required_element_id)
        select v_studio_id, f.element_id, r.element_id
        from public.pole_figure_profiles f
        join public.pole_figure_profiles r
          on r.studio_id = f.studio_id and r.discipline_id = f.discipline_id and r.slug = v_item
        where f.studio_id = v_studio_id
          and f.discipline_id = p_discipline_id
          and f.slug = v_fig ->> 'slug'
        on conflict do nothing;
        if found then
          v_prereqs := v_prereqs + 1;
        end if;
      end loop;
    end if;
  end loop;

  -- 3) Combos base del programa
  if jsonb_typeof(p_payload -> 'combos_base') = 'array' then
    for v_combo in select * from jsonb_array_elements(p_payload -> 'combos_base')
    loop
      v_level := v_combo ->> 'nivel';
      v_level_counter := jsonb_set(
        v_level_counter, array[v_level],
        to_jsonb(coalesce((v_level_counter ->> v_level)::integer, 0) + 1)
      );
      v_combo_name := 'Combo base · ' || initcap(v_level) || ' · ' || (v_level_counter ->> v_level);

      select id into v_combo_id
      from public.technical_combos
      where studio_id = v_studio_id and discipline_id = p_discipline_id and lower(name) = lower(v_combo_name);

      if v_combo_id is null then
        insert into public.technical_combos (studio_id, discipline_id, name, description)
        values (v_studio_id, p_discipline_id, v_combo_name, 'Secuencia del programa base de Pole.')
        returning id into v_combo_id;

        v_pos := 0;
        for v_item in select jsonb_array_elements_text(v_combo -> 'secuencia')
        loop
          v_pos := v_pos + 1;
          insert into public.technical_combo_items (studio_id, combo_id, element_id, position)
          select v_studio_id, v_combo_id, pfp.element_id, v_pos
          from public.pole_figure_profiles pfp
          where pfp.studio_id = v_studio_id and pfp.discipline_id = p_discipline_id and pfp.slug = v_item;
        end loop;
        v_combos := v_combos + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('figures', v_figures, 'prerequisites_added', v_prereqs, 'combos_added', v_combos);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.pole_figure_profiles enable row level security;
alter table public.pole_figure_profiles force row level security;
alter table public.pole_figure_prerequisites enable row level security;
alter table public.pole_figure_prerequisites force row level security;
alter table public.pole_level_map enable row level security;
alter table public.pole_level_map force row level security;
alter table public.student_pole_achievements enable row level security;
alter table public.student_pole_achievements force row level security;
alter table public.student_pole_authorizations enable row level security;
alter table public.student_pole_authorizations force row level security;
alter table public.pole_achievement_events enable row level security;
alter table public.pole_achievement_events force row level security;
alter table public.class_session_pole_plans enable row level security;
alter table public.class_session_pole_plans force row level security;

create policy pole_figure_profiles_staff_read
on public.pole_figure_profiles for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy pole_figure_profiles_configure
on public.pole_figure_profiles for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy pole_figure_prerequisites_staff_read
on public.pole_figure_prerequisites for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy pole_figure_prerequisites_configure
on public.pole_figure_prerequisites for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy pole_level_map_staff_read
on public.pole_level_map for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy pole_level_map_configure
on public.pole_level_map for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy student_pole_achievements_staff_or_self_read
on public.student_pole_achievements for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or private.is_current_student(student_id, studio_id)
);

create policy student_pole_authorizations_staff_or_self_read
on public.student_pole_authorizations for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or private.is_current_student(student_id, studio_id)
);

create policy pole_achievement_events_staff_read
on public.pole_achievement_events for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy class_session_pole_plans_staff_read
on public.class_session_pole_plans for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.pole_figure_profiles from anon, authenticated;
revoke all on public.pole_figure_prerequisites from anon, authenticated;
revoke all on public.pole_level_map from anon, authenticated;
revoke all on public.student_pole_achievements from anon, authenticated;
revoke all on public.student_pole_authorizations from anon, authenticated;
revoke all on public.pole_achievement_events from anon, authenticated;
revoke all on public.class_session_pole_plans from anon, authenticated;

grant select, insert, update, delete on public.pole_figure_profiles to authenticated;
grant select, insert, update, delete on public.pole_figure_prerequisites to authenticated;
grant select, insert, update, delete on public.pole_level_map to authenticated;
grant select on public.student_pole_achievements to authenticated;
grant select on public.student_pole_authorizations to authenticated;
grant select on public.pole_achievement_events to authenticated;
grant select on public.class_session_pole_plans to authenticated;

revoke all on function private.pole_touch_updated_at() from public, anon, authenticated;
revoke all on function private.pole_level_rank(text) from public, anon;
revoke all on function private.pole_default_catalog_level(text) from public, anon;
revoke all on function private.pole_student_level(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.pole_current_student() from public, anon, authenticated;
revoke all on function private.pole_validate_prerequisite() from public, anon, authenticated;
revoke all on function private.pole_validate_profile() from public, anon, authenticated;
revoke all on function private.pole_log_event(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function private.pole_mark_block_reason(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.pole_level_rank(text) to authenticated;
grant execute on function private.pole_default_catalog_level(text) to authenticated;

revoke all on function public.student_pole_figures(uuid) from public, anon;
revoke all on function public.student_mark_pole_figure(uuid) from public, anon;
revoke all on function public.student_unmark_pole_figure(uuid) from public, anon;
revoke all on function public.student_set_pole_photo(uuid, text) from public, anon;
revoke all on function public.staff_save_pole_plan(uuid, text, uuid[], uuid, uuid[]) from public, anon;
revoke all on function public.staff_validate_pole_figures(uuid, jsonb) from public, anon;
revoke all on function public.staff_set_pole_authorization(uuid, uuid, boolean) from public, anon;
revoke all on function public.admin_import_pole_catalog(uuid, jsonb) from public, anon;

grant execute on function public.student_pole_figures(uuid) to authenticated;
grant execute on function public.student_mark_pole_figure(uuid) to authenticated;
grant execute on function public.student_unmark_pole_figure(uuid) to authenticated;
grant execute on function public.student_set_pole_photo(uuid, text) to authenticated;
grant execute on function public.staff_save_pole_plan(uuid, text, uuid[], uuid, uuid[]) to authenticated;
grant execute on function public.staff_validate_pole_figures(uuid, jsonb) to authenticated;
grant execute on function public.staff_set_pole_authorization(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_import_pole_catalog(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage · fotos de logros (privado)
-- Ruta: {auth.uid()}/{element_id}/{archivo}. La alumna administra su carpeta; staff con
-- evaluations.read del estudio de esa alumna puede leer.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pole-achievement-photos',
  'pole-achievement-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pole_photos_select_own_or_staff" on storage.objects;
create policy "pole_photos_select_own_or_staff"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'pole-achievement-photos'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.students s
      where s.user_id::text = (storage.foldername(name))[1]
        and private.has_capability(s.studio_id, 'evaluations.read')
    )
  )
);

drop policy if exists "pole_photos_insert_own" on storage.objects;
create policy "pole_photos_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pole-achievement-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "pole_photos_update_own" on storage.objects;
create policy "pole_photos_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pole-achievement-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'pole-achievement-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "pole_photos_delete_own" on storage.objects;
create policy "pole_photos_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pole-achievement-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
