-- Test doubles for base Supabase services; never apply this fixture to Sandbox/production.

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
create unique index on public.discipline_technical_levels(studio_id,id);
create unique index on public.students(studio_id,id);
create table if not exists public.profiles(id uuid primary key, full_name text);

-- Minimal EVALUACIONES v2 template tables (same columns and checks as Sandbox, no runtime).
create table public.evaluation_templates (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, discipline_id uuid not null,
  discipline_technical_level_id uuid not null, name text not null check (length(trim(name)) > 0),
  created_by uuid, archived_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (studio_id, id)
);
create table public.evaluation_template_versions (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, template_id uuid not null references public.evaluation_templates(id),
  version_number integer not null check (version_number > 0), status text not null default 'draft' check (status in ('draft','active','archived')),
  pass_threshold numeric not null default 80 check (pass_threshold between 0 and 100), default_category_min numeric not null default 70,
  default_attempts_per_element smallint not null default 3, default_attempts_per_combo smallint not null default 3,
  evaluator_instructions text, created_by uuid, activated_at timestamptz, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  schema_version smallint not null default 1 check (schema_version in (1,2)),
  unique (studio_id, id), unique (template_id, version_number)
);
create unique index evaluation_template_one_active_version_uq on public.evaluation_template_versions(template_id) where status = 'active';
create table public.evaluation_template_criteria (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, template_version_id uuid not null references public.evaluation_template_versions(id),
  criterion_key text not null check (criterion_key ~ '^[a-z0-9_]+$'), label text not null check (length(trim(label)) > 0), description text,
  weight_percent numeric not null check (weight_percent between 0 and 100), min_percent numeric check (min_percent is null or min_percent between 0 and 100),
  sort_order smallint not null check (sort_order > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  block_type text not null default 'direct_score' check (block_type in ('direct_score','weighted_criteria','element_list','correct_incorrect','meets')),
  progression_required boolean not null default false, evaluator_instructions text,
  unique (template_version_id, criterion_key), unique (template_version_id, sort_order), unique (studio_id, id)
);
create table public.evaluation_template_elements (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, template_version_id uuid not null references public.evaluation_template_versions(id),
  element_id uuid not null references public.technical_elements(id), criterion_id uuid references public.evaluation_template_criteria(id),
  mandatory boolean not null default false, scored boolean not null default true, max_score numeric not null default 10 check (max_score > 0),
  min_score numeric check (min_score is null or min_score >= 0), attempts_allowed smallint, sort_order smallint not null check (sort_order > 0),
  evaluator_instructions text, element_snapshot jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), item_label text, item_description text,
  item_kind text not null default 'element' check (item_kind in ('criterion','element','question')),
  item_weight_percent numeric check (item_weight_percent is null or item_weight_percent between 0 and 100),
  progression_required boolean not null default false,
  unique (template_version_id, element_id), unique (template_version_id, sort_order), unique (studio_id, id)
);
grant select on public.evaluation_templates, public.evaluation_template_versions, public.evaluation_template_criteria, public.evaluation_template_elements to authenticated;
