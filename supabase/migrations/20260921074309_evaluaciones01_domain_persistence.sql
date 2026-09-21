
-- EVALUACIONES-01-01 · Dominio y persistencia técnica
-- Sandbox first. Technical progression is independent from Rewards/status progression.

insert into public.capabilities (key, description) values
  ('evaluations.read', 'Consultar evaluaciones técnicas y configuración utilizable'),
  ('evaluations.write', 'Crear, capturar y cerrar borradores de evaluaciones técnicas'),
  ('evaluations.configure', 'Configurar niveles, biblioteca técnica y plantillas de evaluación')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities (role, capability_key) values
  ('owner', 'evaluations.read'),
  ('owner', 'evaluations.write'),
  ('owner', 'evaluations.configure'),
  ('admin', 'evaluations.read'),
  ('admin', 'evaluations.write'),
  ('admin', 'evaluations.configure'),
  ('instructor', 'evaluations.read'),
  ('instructor', 'evaluations.write'),
  ('coach', 'evaluations.read'),
  ('coach', 'evaluations.write')
on conflict do nothing;

create table public.technical_level_definitions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  level_key text not null check (level_key ~ '^[a-z0-9_]+$'),
  title text not null check (length(trim(title)) > 0),
  level_order smallint not null check (level_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, level_key),
  unique (studio_id, level_order),
  unique (studio_id, id)
);

create table public.discipline_technical_levels (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  technical_level_id uuid not null references public.technical_level_definitions(id) on delete restrict,
  discipline_order smallint not null check (discipline_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, discipline_id, technical_level_id),
  unique (studio_id, discipline_id, discipline_order),
  unique (studio_id, id)
);

create table public.student_discipline_levels (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  discipline_technical_level_id uuid not null references public.discipline_technical_levels(id) on delete restrict,
  effective_from date not null default current_date,
  source_evaluation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, student_id, discipline_id),
  unique (studio_id, id)
);

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

create unique index technical_elements_name_uq
on public.technical_elements (studio_id, discipline_id, lower(name));

create table public.technical_combos (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id)
);

create unique index technical_combos_name_uq
on public.technical_combos (studio_id, discipline_id, lower(name));

create table public.technical_combo_items (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  combo_id uuid not null references public.technical_combos(id) on delete cascade,
  element_id uuid not null references public.technical_elements(id) on delete restrict,
  position smallint not null check (position > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (combo_id, position),
  unique (combo_id, element_id, position)
);

create table public.evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete restrict,
  discipline_technical_level_id uuid not null references public.discipline_technical_levels(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id)
);

create table public.evaluation_template_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_id uuid not null references public.evaluation_templates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  pass_threshold numeric(5,2) not null default 80 check (pass_threshold between 0 and 100),
  default_category_min numeric(5,2) not null default 70 check (default_category_min between 0 and 100),
  default_attempts_per_element smallint not null default 3 check (default_attempts_per_element > 0),
  default_attempts_per_combo smallint not null default 3 check (default_attempts_per_combo > 0),
  evaluator_instructions text,
  created_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, version_number),
  unique (studio_id, id)
);

create unique index evaluation_template_one_active_version_uq
on public.evaluation_template_versions (template_id)
where status = 'active';

create table public.evaluation_template_criteria (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_version_id uuid not null references public.evaluation_template_versions(id) on delete cascade,
  criterion_key text not null check (criterion_key ~ '^[a-z0-9_]+$'),
  label text not null check (length(trim(label)) > 0),
  description text,
  weight_percent numeric(5,2) not null check (weight_percent >= 0 and weight_percent <= 100),
  min_percent numeric(5,2) check (min_percent is null or (min_percent >= 0 and min_percent <= 100)),
  sort_order smallint not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, criterion_key),
  unique (template_version_id, sort_order),
  unique (studio_id, id)
);

create table public.evaluation_template_elements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_version_id uuid not null references public.evaluation_template_versions(id) on delete cascade,
  element_id uuid not null references public.technical_elements(id) on delete restrict,
  criterion_id uuid references public.evaluation_template_criteria(id) on delete restrict,
  mandatory boolean not null default false,
  scored boolean not null default true,
  max_score numeric(6,2) not null default 10 check (max_score > 0),
  min_score numeric(6,2) check (min_score is null or min_score >= 0),
  attempts_allowed smallint check (attempts_allowed is null or attempts_allowed > 0),
  sort_order smallint not null check (sort_order > 0),
  evaluator_instructions text,
  element_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, element_id),
  unique (template_version_id, sort_order),
  unique (studio_id, id)
);

create table public.evaluation_template_combos (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_version_id uuid not null references public.evaluation_template_versions(id) on delete cascade,
  combo_id uuid not null references public.technical_combos(id) on delete restrict,
  criterion_id uuid references public.evaluation_template_criteria(id) on delete restrict,
  mandatory boolean not null default false,
  scored boolean not null default false,
  max_score numeric(6,2) not null default 10 check (max_score > 0),
  min_score numeric(6,2) check (min_score is null or min_score >= 0),
  attempts_allowed smallint check (attempts_allowed is null or attempts_allowed > 0),
  sort_order smallint not null check (sort_order > 0),
  evaluator_instructions text,
  combo_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, combo_id),
  unique (template_version_id, sort_order),
  unique (studio_id, id)
);

create table public.technical_evaluations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  student_name_snapshot text not null,
  discipline_id uuid not null references public.disciplines(id) on delete restrict,
  current_discipline_level_id_at_start uuid references public.discipline_technical_levels(id) on delete restrict,
  target_discipline_level_id uuid not null references public.discipline_technical_levels(id) on delete restrict,
  resulting_discipline_level_id uuid references public.discipline_technical_levels(id) on delete restrict,
  template_version_id uuid not null references public.evaluation_template_versions(id) on delete restrict,
  evaluator_user_id uuid references auth.users(id) on delete set null,
  evaluator_name_snapshot text,
  evaluation_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'published')),
  automatic_outcome text check (automatic_outcome is null or automatic_outcome in ('approved', 'stays', 'incomplete')),
  final_outcome text check (final_outcome is null or final_outcome in ('approved', 'stays', 'incomplete')),
  total_score numeric(5,2) check (total_score is null or (total_score >= 0 and total_score <= 100)),
  override_reason text,
  override_by uuid references auth.users(id) on delete set null,
  override_at timestamptz,
  strengths text[] not null default '{}'::text[],
  improvement_areas text[] not null default '{}'::text[],
  coach_message text,
  next_objective text,
  supersedes_evaluation_id uuid references public.technical_evaluations(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now(),
  published_at timestamptz,
  constraint technical_evaluations_published_complete_ck check (
    status = 'draft'
    or (final_outcome is not null and published_at is not null)
  ),
  constraint technical_evaluations_override_ck check (
    (override_reason is null and override_by is null and override_at is null)
    or (override_reason is not null and override_by is not null and override_at is not null)
  ),
  unique (studio_id, id)
);

alter table public.student_discipline_levels
  add constraint student_discipline_levels_source_evaluation_fk
  foreign key (source_evaluation_id)
  references public.technical_evaluations(id)
  on delete set null;

create table public.technical_evaluation_element_results (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  template_element_id uuid not null references public.evaluation_template_elements(id) on delete restrict,
  result_status text not null default 'not_evaluated'
    check (result_status in ('meets', 'does_not_meet', 'not_evaluated')),
  score numeric(6,2) check (score is null or score >= 0),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  notes text,
  quick_comments text[] not null default '{}'::text[],
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, template_element_id)
);

create table public.technical_evaluation_combo_results (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  template_combo_id uuid not null references public.evaluation_template_combos(id) on delete restrict,
  result_status text not null default 'not_evaluated'
    check (result_status in ('meets', 'does_not_meet', 'not_evaluated')),
  score numeric(6,2) check (score is null or score >= 0),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  notes text,
  quick_comments text[] not null default '{}'::text[],
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, template_combo_id)
);

create table public.technical_evaluation_criterion_results (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  template_criterion_id uuid not null references public.evaluation_template_criteria(id) on delete restrict,
  score_percent numeric(5,2) not null check (score_percent between 0 and 100),
  weighted_points numeric(5,2) not null check (weighted_points >= 0 and weighted_points <= 100),
  passed boolean not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (evaluation_id, template_criterion_id)
);

create table public.technical_evaluation_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'draft_saved', 'paused', 'resumed', 'override_applied',
    'published', 'superseded', 'voided'
  )),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.evaluation_quick_comments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid references public.disciplines(id) on delete cascade,
  comment_text text not null check (length(trim(comment_text)) > 0),
  active boolean not null default true,
  sort_order smallint not null default 1 check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index discipline_technical_levels_lookup_idx
on public.discipline_technical_levels (studio_id, discipline_id, active, discipline_order);

create index student_discipline_levels_student_idx
on public.student_discipline_levels (studio_id, student_id, discipline_id);

create index evaluation_templates_lookup_idx
on public.evaluation_templates (studio_id, discipline_id, discipline_technical_level_id);

create index evaluation_template_versions_lookup_idx
on public.evaluation_template_versions (studio_id, template_id, status, version_number desc);

create index technical_evaluations_dashboard_idx
on public.technical_evaluations (studio_id, status, evaluation_date desc);

create index technical_evaluations_student_idx
on public.technical_evaluations (studio_id, student_id, discipline_id, evaluation_date desc);

create index technical_evaluation_events_timeline_idx
on public.technical_evaluation_events (studio_id, evaluation_id, created_at);

create index evaluation_quick_comments_lookup_idx
on public.evaluation_quick_comments (studio_id, discipline_id, active, sort_order);

create or replace function private.evaluations_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.evaluations_validate_discipline_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.disciplines d
    join public.technical_level_definitions l
      on l.id = new.technical_level_id
     and l.studio_id = new.studio_id
    where d.id = new.discipline_id
      and d.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_discipline_level_studio_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.evaluations_validate_catalog_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.disciplines d
    where d.id = new.discipline_id
      and d.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_catalog_discipline_studio_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.evaluations_validate_combo_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_combo record;
  v_element record;
begin
  select studio_id, discipline_id into v_combo
  from public.technical_combos where id = new.combo_id;

  select studio_id, discipline_id into v_element
  from public.technical_elements where id = new.element_id;

  if v_combo.studio_id is distinct from new.studio_id
     or v_element.studio_id is distinct from new.studio_id
     or v_combo.discipline_id is distinct from v_element.discipline_id then
    raise exception 'evaluation_combo_item_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.evaluations_validate_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.discipline_technical_levels dl
    where dl.id = new.discipline_technical_level_id
      and dl.studio_id = new.studio_id
      and dl.discipline_id = new.discipline_id
  ) then
    raise exception 'evaluation_template_level_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.evaluations_validate_template_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.evaluation_templates t
    where t.id = new.template_id
      and t.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_template_version_studio_mismatch';
  end if;

  if new.status = 'active' and new.activated_at is null then
    new.activated_at := now();
  end if;

  if new.status = 'archived' and new.archived_at is null then
    new.archived_at := now();
  end if;

  return new;
end;
$$;

create or replace function private.evaluations_guard_used_template_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_used boolean;
begin
  v_version_id := case
    when tg_table_name = 'evaluation_template_versions' then old.id
    else coalesce(new.template_version_id, old.template_version_id)
  end;

  select exists (
    select 1 from public.technical_evaluations e
    where e.template_version_id = v_version_id
  ) into v_used;

  if not v_used then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'evaluation_template_versions' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'status' - 'archived_at' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'status' - 'archived_at' - 'updated_at') then
      raise exception 'evaluation_template_version_in_use';
    end if;
    return new;
  end if;

  raise exception 'evaluation_template_version_in_use';
end;
$$;

create or replace function private.evaluations_validate_template_criterion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.evaluation_template_versions v
    where v.id = new.template_version_id
      and v.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_template_criterion_studio_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.evaluations_validate_template_element()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_discipline uuid;
  v_element record;
begin
  select t.discipline_id
    into v_template_discipline
  from public.evaluation_template_versions v
  join public.evaluation_templates t on t.id = v.template_id
  where v.id = new.template_version_id
    and v.studio_id = new.studio_id;

  select studio_id, discipline_id, name, element_kind, description
    into v_element
  from public.technical_elements
  where id = new.element_id;

  if v_template_discipline is null
     or v_element.studio_id is distinct from new.studio_id
     or v_element.discipline_id is distinct from v_template_discipline then
    raise exception 'evaluation_template_element_mismatch';
  end if;

  if new.criterion_id is not null and not exists (
    select 1 from public.evaluation_template_criteria c
    where c.id = new.criterion_id
      and c.template_version_id = new.template_version_id
      and c.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_template_element_criterion_mismatch';
  end if;

  new.element_snapshot := jsonb_build_object(
    'name', v_element.name,
    'kind', v_element.element_kind,
    'description', v_element.description
  );

  return new;
end;
$$;

create or replace function private.evaluations_validate_template_combo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_discipline uuid;
  v_combo record;
  v_items jsonb;
begin
  select t.discipline_id
    into v_template_discipline
  from public.evaluation_template_versions v
  join public.evaluation_templates t on t.id = v.template_id
  where v.id = new.template_version_id
    and v.studio_id = new.studio_id;

  select studio_id, discipline_id, name, description
    into v_combo
  from public.technical_combos
  where id = new.combo_id;

  if v_template_discipline is null
     or v_combo.studio_id is distinct from new.studio_id
     or v_combo.discipline_id is distinct from v_template_discipline then
    raise exception 'evaluation_template_combo_mismatch';
  end if;

  if new.criterion_id is not null and not exists (
    select 1 from public.evaluation_template_criteria c
    where c.id = new.criterion_id
      and c.template_version_id = new.template_version_id
      and c.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_template_combo_criterion_mismatch';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position', ci.position,
      'element_id', e.id,
      'name', e.name,
      'kind', e.element_kind,
      'notes', ci.notes
    ) order by ci.position
  ), '[]'::jsonb)
  into v_items
  from public.technical_combo_items ci
  join public.technical_elements e on e.id = ci.element_id
  where ci.combo_id = new.combo_id;

  new.combo_snapshot := jsonb_build_object(
    'name', v_combo.name,
    'description', v_combo.description,
    'items', v_items
  );

  return new;
end;
$$;

create or replace function private.evaluations_validate_student_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.students s
    join public.discipline_technical_levels dl
      on dl.id = new.discipline_technical_level_id
     and dl.studio_id = new.studio_id
     and dl.discipline_id = new.discipline_id
    where s.id = new.student_id
      and s.studio_id = new.studio_id
  ) then
    raise exception 'evaluation_student_level_mismatch';
  end if;
  return new;
end;
$$;

create or replace function private.evaluations_validate_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_template record;
  v_current_level uuid;
begin
  if new.student_id is null then
    raise exception 'evaluation_student_required';
  end if;

  select studio_id, full_name
    into v_student
  from public.students
  where id = new.student_id;

  if v_student.studio_id is distinct from new.studio_id then
    raise exception 'evaluation_student_studio_mismatch';
  end if;

  new.student_name_snapshot := coalesce(nullif(trim(new.student_name_snapshot), ''), v_student.full_name);

  if not exists (
    select 1 from public.discipline_technical_levels dl
    where dl.id = new.target_discipline_level_id
      and dl.studio_id = new.studio_id
      and dl.discipline_id = new.discipline_id
      and dl.active
  ) then
    raise exception 'evaluation_target_level_mismatch';
  end if;

  select
    v.status as version_status,
    t.studio_id,
    t.discipline_id,
    t.discipline_technical_level_id
  into v_template
  from public.evaluation_template_versions v
  join public.evaluation_templates t on t.id = v.template_id
  where v.id = new.template_version_id;

  if v_template.studio_id is distinct from new.studio_id
     or v_template.discipline_id is distinct from new.discipline_id
     or v_template.discipline_technical_level_id is distinct from new.target_discipline_level_id then
    raise exception 'evaluation_template_target_mismatch';
  end if;

  if v_template.version_status <> 'active' then
    raise exception 'evaluation_template_version_not_active';
  end if;

  if new.evaluator_user_id is not null and not exists (
    select 1 from public.studio_memberships sm
    where sm.studio_id = new.studio_id
      and sm.user_id = new.evaluator_user_id
      and sm.active
  ) then
    raise exception 'evaluation_evaluator_not_active_member';
  end if;

  if new.current_discipline_level_id_at_start is null then
    select sdl.discipline_technical_level_id
      into v_current_level
    from public.student_discipline_levels sdl
    where sdl.studio_id = new.studio_id
      and sdl.student_id = new.student_id
      and sdl.discipline_id = new.discipline_id;

    new.current_discipline_level_id_at_start := v_current_level;
  end if;

  new.last_saved_at := now();
  return new;
end;
$$;

create or replace function private.evaluations_guard_evaluation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'published_evaluation_immutable';
    end if;
    return old;
  end if;

  if old.status = 'published' then
    raise exception 'published_evaluation_immutable';
  end if;

  if old.status = 'draft'
     and new.status = 'published'
     and coalesce(current_setting('app.evaluation_publish', true), '') <> 'on' then
    raise exception 'evaluation_publish_rpc_required';
  end if;

  new.updated_at := now();
  new.last_saved_at := now();
  return new;
end;
$$;

create or replace function private.evaluations_guard_result_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation_id uuid;
  v_status text;
begin
  v_evaluation_id := case when tg_op = 'DELETE' then old.evaluation_id else new.evaluation_id end;

  select status into v_status
  from public.technical_evaluations
  where id = v_evaluation_id;

  if v_status = 'published' then
    raise exception 'published_evaluation_results_immutable';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.evaluations_seed_levels_for_new_studio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.technical_level_definitions
    (studio_id, level_key, title, level_order)
  values
    (new.id, 'beginner', 'Principiante', 1),
    (new.id, 'intermediate', 'Intermedio', 2),
    (new.id, 'upper_intermediate', 'Intermedio Avanzado', 3),
    (new.id, 'advanced', 'Avanzado', 4),
    (new.id, 'elite', 'Élite', 5)
  on conflict (studio_id, level_key) do nothing;

  return new;
end;
$$;

create trigger discipline_technical_levels_validate
before insert or update on public.discipline_technical_levels
for each row execute function private.evaluations_validate_discipline_level();

create trigger technical_elements_validate
before insert or update on public.technical_elements
for each row execute function private.evaluations_validate_catalog_item();

create trigger technical_combos_validate
before insert or update on public.technical_combos
for each row execute function private.evaluations_validate_catalog_item();

create trigger technical_combo_items_validate
before insert or update on public.technical_combo_items
for each row execute function private.evaluations_validate_combo_item();

create trigger evaluation_templates_validate
before insert or update on public.evaluation_templates
for each row execute function private.evaluations_validate_template();

create trigger evaluation_template_versions_validate
before insert or update on public.evaluation_template_versions
for each row execute function private.evaluations_validate_template_version();

create trigger evaluation_template_versions_guard_used
before update or delete on public.evaluation_template_versions
for each row execute function private.evaluations_guard_used_template_version();

create trigger evaluation_template_criteria_validate
before insert or update on public.evaluation_template_criteria
for each row execute function private.evaluations_validate_template_criterion();

create trigger evaluation_template_criteria_guard_used
before update or delete on public.evaluation_template_criteria
for each row execute function private.evaluations_guard_used_template_version();

create trigger evaluation_template_elements_validate
before insert or update on public.evaluation_template_elements
for each row execute function private.evaluations_validate_template_element();

create trigger evaluation_template_elements_guard_used
before update or delete on public.evaluation_template_elements
for each row execute function private.evaluations_guard_used_template_version();

create trigger evaluation_template_combos_validate
before insert or update on public.evaluation_template_combos
for each row execute function private.evaluations_validate_template_combo();

create trigger evaluation_template_combos_guard_used
before update or delete on public.evaluation_template_combos
for each row execute function private.evaluations_guard_used_template_version();

create trigger student_discipline_levels_validate
before insert or update on public.student_discipline_levels
for each row execute function private.evaluations_validate_student_level();

create trigger technical_evaluations_validate
before insert or update on public.technical_evaluations
for each row execute function private.evaluations_validate_evaluation();

create trigger technical_evaluations_guard_history
before update or delete on public.technical_evaluations
for each row execute function private.evaluations_guard_evaluation_history();

create trigger technical_evaluation_element_results_guard
before insert or update or delete on public.technical_evaluation_element_results
for each row execute function private.evaluations_guard_result_history();

create trigger technical_evaluation_combo_results_guard
before insert or update or delete on public.technical_evaluation_combo_results
for each row execute function private.evaluations_guard_result_history();

create trigger technical_levels_touch_updated_at
before update on public.technical_level_definitions
for each row execute function private.evaluations_touch_updated_at();

create trigger discipline_technical_levels_touch_updated_at
before update on public.discipline_technical_levels
for each row execute function private.evaluations_touch_updated_at();

create trigger student_discipline_levels_touch_updated_at
before update on public.student_discipline_levels
for each row execute function private.evaluations_touch_updated_at();

create trigger technical_elements_touch_updated_at
before update on public.technical_elements
for each row execute function private.evaluations_touch_updated_at();

create trigger technical_combos_touch_updated_at
before update on public.technical_combos
for each row execute function private.evaluations_touch_updated_at();

create trigger evaluation_templates_touch_updated_at
before update on public.evaluation_templates
for each row execute function private.evaluations_touch_updated_at();

create trigger evaluation_template_versions_touch_updated_at
before update on public.evaluation_template_versions
for each row execute function private.evaluations_touch_updated_at();

create trigger evaluation_template_criteria_touch_updated_at
before update on public.evaluation_template_criteria
for each row execute function private.evaluations_touch_updated_at();

create trigger evaluation_template_elements_touch_updated_at
before update on public.evaluation_template_elements
for each row execute function private.evaluations_touch_updated_at();

create trigger evaluation_template_combos_touch_updated_at
before update on public.evaluation_template_combos
for each row execute function private.evaluations_touch_updated_at();

create trigger evaluation_quick_comments_touch_updated_at
before update on public.evaluation_quick_comments
for each row execute function private.evaluations_touch_updated_at();

drop trigger if exists evaluations_seed_studio_levels on public.studios;
create trigger evaluations_seed_studio_levels
after insert on public.studios
for each row execute function private.evaluations_seed_levels_for_new_studio();

insert into public.technical_level_definitions
  (studio_id, level_key, title, level_order)
select s.id, v.level_key, v.title, v.level_order
from public.studios s
cross join (
  values
    ('beginner', 'Principiante', 1),
    ('intermediate', 'Intermedio', 2),
    ('upper_intermediate', 'Intermedio Avanzado', 3),
    ('advanced', 'Avanzado', 4),
    ('elite', 'Élite', 5)
) as v(level_key, title, level_order)
on conflict (studio_id, level_key) do nothing;

alter table public.technical_level_definitions enable row level security;
alter table public.discipline_technical_levels enable row level security;
alter table public.student_discipline_levels enable row level security;
alter table public.technical_elements enable row level security;
alter table public.technical_combos enable row level security;
alter table public.technical_combo_items enable row level security;
alter table public.evaluation_templates enable row level security;
alter table public.evaluation_template_versions enable row level security;
alter table public.evaluation_template_criteria enable row level security;
alter table public.evaluation_template_elements enable row level security;
alter table public.evaluation_template_combos enable row level security;
alter table public.technical_evaluations enable row level security;
alter table public.technical_evaluation_element_results enable row level security;
alter table public.technical_evaluation_combo_results enable row level security;
alter table public.technical_evaluation_criterion_results enable row level security;
alter table public.technical_evaluation_events enable row level security;
alter table public.evaluation_quick_comments enable row level security;

create policy technical_levels_staff_read
on public.technical_level_definitions for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy technical_levels_configure
on public.technical_level_definitions for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy discipline_technical_levels_staff_read
on public.discipline_technical_levels for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy discipline_technical_levels_configure
on public.discipline_technical_levels for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy student_discipline_levels_staff_or_self_read
on public.student_discipline_levels for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or private.is_current_student(student_id, studio_id)
);

create policy technical_elements_staff_read
on public.technical_elements for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy technical_elements_configure
on public.technical_elements for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy technical_combos_staff_read
on public.technical_combos for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy technical_combos_configure
on public.technical_combos for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy technical_combo_items_staff_read
on public.technical_combo_items for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy technical_combo_items_configure
on public.technical_combo_items for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy evaluation_templates_staff_read
on public.evaluation_templates for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_templates_configure
on public.evaluation_templates for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy evaluation_template_versions_staff_read
on public.evaluation_template_versions for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_template_versions_configure
on public.evaluation_template_versions for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy evaluation_template_criteria_staff_read
on public.evaluation_template_criteria for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_template_criteria_configure
on public.evaluation_template_criteria for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy evaluation_template_elements_staff_read
on public.evaluation_template_elements for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_template_elements_configure
on public.evaluation_template_elements for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy evaluation_template_combos_staff_read
on public.evaluation_template_combos for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_template_combos_configure
on public.evaluation_template_combos for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

create policy technical_evaluations_staff_or_self_read
on public.technical_evaluations for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or (
    status = 'published'
    and student_id is not null
    and private.is_current_student(student_id, studio_id)
  )
);

create policy technical_evaluations_staff_insert
on public.technical_evaluations for insert to authenticated
with check (private.has_capability(studio_id, 'evaluations.write'));

create policy technical_evaluations_staff_update
on public.technical_evaluations for update to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));

create policy technical_evaluations_staff_delete_draft
on public.technical_evaluations for delete to authenticated
using (
  status = 'draft'
  and private.has_capability(studio_id, 'evaluations.write')
);

create policy technical_evaluation_element_results_staff_or_self_read
on public.technical_evaluation_element_results for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or exists (
    select 1 from public.technical_evaluations e
    where e.id = evaluation_id
      and e.studio_id = technical_evaluation_element_results.studio_id
      and e.status = 'published'
      and e.student_id is not null
      and private.is_current_student(e.student_id, e.studio_id)
  )
);

create policy technical_evaluation_element_results_staff_write
on public.technical_evaluation_element_results for all to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));

create policy technical_evaluation_combo_results_staff_or_self_read
on public.technical_evaluation_combo_results for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or exists (
    select 1 from public.technical_evaluations e
    where e.id = evaluation_id
      and e.studio_id = technical_evaluation_combo_results.studio_id
      and e.status = 'published'
      and e.student_id is not null
      and private.is_current_student(e.student_id, e.studio_id)
  )
);

create policy technical_evaluation_combo_results_staff_write
on public.technical_evaluation_combo_results for all to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));

create policy technical_evaluation_criterion_results_staff_or_self_read
on public.technical_evaluation_criterion_results for select to authenticated
using (
  private.has_capability(studio_id, 'evaluations.read')
  or exists (
    select 1 from public.technical_evaluations e
    where e.id = evaluation_id
      and e.studio_id = technical_evaluation_criterion_results.studio_id
      and e.status = 'published'
      and e.student_id is not null
      and private.is_current_student(e.student_id, e.studio_id)
  )
);

create policy technical_evaluation_criterion_results_staff_write
on public.technical_evaluation_criterion_results for all to authenticated
using (private.has_capability(studio_id, 'evaluations.write'))
with check (private.has_capability(studio_id, 'evaluations.write'));

create policy technical_evaluation_events_staff_read
on public.technical_evaluation_events for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_quick_comments_staff_read
on public.evaluation_quick_comments for select to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

create policy evaluation_quick_comments_configure
on public.evaluation_quick_comments for all to authenticated
using (private.has_capability(studio_id, 'evaluations.configure'))
with check (private.has_capability(studio_id, 'evaluations.configure'));

revoke all on public.technical_level_definitions from anon, authenticated;
revoke all on public.discipline_technical_levels from anon, authenticated;
revoke all on public.student_discipline_levels from anon, authenticated;
revoke all on public.technical_elements from anon, authenticated;
revoke all on public.technical_combos from anon, authenticated;
revoke all on public.technical_combo_items from anon, authenticated;
revoke all on public.evaluation_templates from anon, authenticated;
revoke all on public.evaluation_template_versions from anon, authenticated;
revoke all on public.evaluation_template_criteria from anon, authenticated;
revoke all on public.evaluation_template_elements from anon, authenticated;
revoke all on public.evaluation_template_combos from anon, authenticated;
revoke all on public.technical_evaluations from anon, authenticated;
revoke all on public.technical_evaluation_element_results from anon, authenticated;
revoke all on public.technical_evaluation_combo_results from anon, authenticated;
revoke all on public.technical_evaluation_criterion_results from anon, authenticated;
revoke all on public.technical_evaluation_events from anon, authenticated;
revoke all on public.evaluation_quick_comments from anon, authenticated;

grant select, insert, update, delete on public.technical_level_definitions to authenticated;
grant select, insert, update, delete on public.discipline_technical_levels to authenticated;
grant select on public.student_discipline_levels to authenticated;
grant select, insert, update, delete on public.technical_elements to authenticated;
grant select, insert, update, delete on public.technical_combos to authenticated;
grant select, insert, update, delete on public.technical_combo_items to authenticated;
grant select, insert, update, delete on public.evaluation_templates to authenticated;
grant select, insert, update, delete on public.evaluation_template_versions to authenticated;
grant select, insert, update, delete on public.evaluation_template_criteria to authenticated;
grant select, insert, update, delete on public.evaluation_template_elements to authenticated;
grant select, insert, update, delete on public.evaluation_template_combos to authenticated;
grant select, insert, update, delete on public.technical_evaluations to authenticated;
grant select, insert, update, delete on public.technical_evaluation_element_results to authenticated;
grant select, insert, update, delete on public.technical_evaluation_combo_results to authenticated;
grant select, insert, update, delete on public.technical_evaluation_criterion_results to authenticated;
grant select on public.technical_evaluation_events to authenticated;
grant select, insert, update, delete on public.evaluation_quick_comments to authenticated;

revoke all on function private.evaluations_touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_discipline_level() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_catalog_item() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_combo_item() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_template() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_template_version() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_guard_used_template_version() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_template_criterion() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_template_element() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_template_combo() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_student_level() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_validate_evaluation() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_guard_evaluation_history() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_guard_result_history() from public, anon, authenticated, service_role;
revoke all on function private.evaluations_seed_levels_for_new_studio() from public, anon, authenticated, service_role;
