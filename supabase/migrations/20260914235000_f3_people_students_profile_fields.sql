create type public.student_lifecycle_status as enum ('active','inactive','archived');
create type public.profile_completeness_status as enum ('complete','incomplete');
create type public.profile_field_type as enum ('short_text','long_text','number','date','boolean','single_select','multi_select');

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  first_name text not null,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.person_contacts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  kind text not null check (kind in ('phone','email')),
  value text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint person_contacts_phone_e164 check (kind <> 'phone' or value ~ '^\+[1-9][0-9]{7,14}$')
);

create unique index person_contacts_unique_value_per_studio
  on public.person_contacts (studio_id, kind, lower(value));
create index persons_studio_name_idx on public.persons (studio_id, first_name, last_name);
create index person_contacts_person_idx on public.person_contacts (person_id);
create index person_contacts_studio_kind_idx on public.person_contacts (studio_id, kind);

alter table public.students
  add column person_id uuid references public.persons(id) on delete restrict,
  add column lifecycle_status public.student_lifecycle_status not null default 'active',
  add column profile_status public.profile_completeness_status not null default 'incomplete',
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id);

create unique index students_person_unique on public.students(person_id) where person_id is not null;
create index students_studio_lifecycle_idx on public.students(studio_id, lifecycle_status);

create table public.profile_field_definitions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  entity_type text not null check (entity_type in ('student','instructor')),
  key text not null,
  label text not null,
  field_type public.profile_field_type not null,
  required boolean not null default false,
  active boolean not null default true,
  options jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, entity_type, key)
);

create table public.profile_field_values (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.profile_field_definitions(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (definition_id, person_id)
);

create index profile_field_definitions_studio_idx on public.profile_field_definitions(studio_id, entity_type, active, sort_order);
create index profile_field_values_person_idx on public.profile_field_values(person_id);

alter table public.persons enable row level security;
alter table public.person_contacts enable row level security;
alter table public.profile_field_definitions enable row level security;
alter table public.profile_field_values enable row level security;

create policy persons_staff_read on public.persons for select to authenticated
using (private.has_capability(studio_id, 'students.read') or private.has_capability(studio_id, 'instructors.read'));
create policy persons_staff_write on public.persons for all to authenticated
using (private.has_capability(studio_id, 'students.write') or private.has_capability(studio_id, 'instructors.write'))
with check (private.has_capability(studio_id, 'students.write') or private.has_capability(studio_id, 'instructors.write'));

create policy person_contacts_staff_read on public.person_contacts for select to authenticated
using (private.has_capability(studio_id, 'students.read') or private.has_capability(studio_id, 'instructors.read'));
create policy person_contacts_staff_write on public.person_contacts for all to authenticated
using (private.has_capability(studio_id, 'students.write') or private.has_capability(studio_id, 'instructors.write'))
with check (private.has_capability(studio_id, 'students.write') or private.has_capability(studio_id, 'instructors.write'));

create policy profile_field_definitions_read on public.profile_field_definitions for select to authenticated
using (private.is_studio_member(studio_id));
create policy profile_field_definitions_write on public.profile_field_definitions for all to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

create policy profile_field_values_staff_read on public.profile_field_values for select to authenticated
using (private.has_capability(studio_id, 'students.read') or private.has_capability(studio_id, 'instructors.read'));
create policy profile_field_values_staff_write on public.profile_field_values for all to authenticated
using (private.has_capability(studio_id, 'students.write') or private.has_capability(studio_id, 'instructors.write'))
with check (private.has_capability(studio_id, 'students.write') or private.has_capability(studio_id, 'instructors.write'));

grant select, insert, update on public.persons to authenticated;
grant select, insert, update on public.person_contacts to authenticated;
grant select, insert, update, delete on public.profile_field_definitions to authenticated;
grant select, insert, update, delete on public.profile_field_values to authenticated;

insert into public.profile_field_definitions (studio_id, entity_type, key, label, field_type, required, sort_order)
select id, 'student', 'first_name', 'Nombre', 'short_text', true, 10 from public.studios
on conflict do nothing;
insert into public.profile_field_definitions (studio_id, entity_type, key, label, field_type, required, sort_order)
select id, 'student', 'last_name', 'Apellido', 'short_text', false, 20 from public.studios
on conflict do nothing;
insert into public.profile_field_definitions (studio_id, entity_type, key, label, field_type, required, sort_order)
select id, 'student', 'phone', 'Teléfono', 'short_text', true, 30 from public.studios
on conflict do nothing;
insert into public.profile_field_definitions (studio_id, entity_type, key, label, field_type, required, sort_order)
select id, 'student', 'email', 'Correo', 'short_text', false, 40 from public.studios
on conflict do nothing;
