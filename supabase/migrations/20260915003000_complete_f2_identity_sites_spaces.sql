do $$
begin
  if not exists (select 1 from pg_type where typname = 'studio_status') then
    create type public.studio_status as enum ('active', 'inactive');
  end if;
end
$$;

alter table public.studios
  add column if not exists locale text not null default 'es-MX',
  add column if not exists primary_color text not null default '#FF0A8A',
  add column if not exists status public.studio_status not null default 'active';

update public.studios
set name = 'Demeter Fitness Studio',
    slug = 'demeter-fitness',
    locale = 'es-MX',
    primary_color = '#FF0A8A',
    status = 'active'
where slug = 'demeter';

create table if not exists public.user_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_accounts(id)
select u.id from auth.users u
on conflict (id) do nothing;

alter table public.user_accounts enable row level security;

drop policy if exists user_accounts_select on public.user_accounts;
create policy user_accounts_select
on public.user_accounts
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.studio_memberships m
    where m.user_id = user_accounts.id
      and private.has_capability(m.studio_id, 'settings.write')
  )
);

grant select on public.user_accounts to authenticated;

alter table public.persons
  drop constraint if exists persons_studio_id_id_key;
alter table public.persons
  add constraint persons_studio_id_id_key unique (studio_id, id);

alter table public.studio_memberships
  add column if not exists person_id uuid;

alter table public.studio_memberships
  drop constraint if exists studio_memberships_user_id_fkey;
alter table public.studio_memberships
  add constraint studio_memberships_user_id_fkey
  foreign key (user_id) references public.user_accounts(id) on delete cascade;

alter table public.studio_memberships
  drop constraint if exists studio_memberships_studio_person_fkey;
alter table public.studio_memberships
  add constraint studio_memberships_studio_person_fkey
  foreign key (studio_id, person_id) references public.persons(studio_id, id) on delete set null;

create index if not exists studio_memberships_person_id_idx
  on public.studio_memberships(person_id)
  where person_id is not null;

alter table public.students
  drop constraint if exists students_user_id_fkey;
alter table public.students
  add constraint students_user_id_fkey
  foreign key (user_id) references public.user_accounts(id) on delete set null;

alter table public.student_packages
  drop constraint if exists student_packages_student_user_id_fkey;
alter table public.student_packages
  add constraint student_packages_student_user_id_fkey
  foreign key (student_user_id) references public.user_accounts(id) on delete set null;

alter table public.reservations
  drop constraint if exists reservations_student_user_id_fkey;
alter table public.reservations
  add constraint reservations_student_user_id_fkey
  foreign key (student_user_id) references public.user_accounts(id) on delete set null;

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, name)
);

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  capacity integer check (capacity is null or capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name)
);

create index if not exists sites_studio_id_idx on public.sites(studio_id);
create index if not exists spaces_studio_id_idx on public.spaces(studio_id);
create index if not exists spaces_site_id_idx on public.spaces(site_id);

insert into public.sites(id, studio_id, name, address, active)
select l.id, l.studio_id, l.name, l.address, l.active
from public.studio_locations l
on conflict (id) do nothing;

insert into public.spaces(id, studio_id, site_id, name, active)
select l.id, l.studio_id, l.id, l.name, l.active
from public.studio_locations l
on conflict (id) do nothing;

alter table public.class_sessions
  add column if not exists space_id uuid;

update public.class_sessions
set space_id = location_id
where space_id is null
  and location_id is not null
  and exists (select 1 from public.spaces s where s.id = class_sessions.location_id);

alter table public.class_sessions
  drop constraint if exists class_sessions_space_id_fkey;
alter table public.class_sessions
  add constraint class_sessions_space_id_fkey
  foreign key (space_id) references public.spaces(id) on delete set null;

create index if not exists class_sessions_space_id_idx on public.class_sessions(space_id);

alter table public.sites enable row level security;
alter table public.spaces enable row level security;

drop policy if exists sites_select on public.sites;
drop policy if exists sites_write on public.sites;
create policy sites_select
on public.sites
for select
to authenticated
using (private.is_studio_member(studio_id));
create policy sites_write
on public.sites
for all
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists spaces_select on public.spaces;
drop policy if exists spaces_write on public.spaces;
create policy spaces_select
on public.spaces
for select
to authenticated
using (private.is_studio_member(studio_id));
create policy spaces_write
on public.spaces
for all
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

grant select, insert, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.spaces to authenticated;

drop policy if exists locations_admin_delete on public.studio_locations;
drop policy if exists locations_admin_insert on public.studio_locations;
drop policy if exists locations_admin_update on public.studio_locations;
create policy locations_settings_insert
on public.studio_locations
for insert
to authenticated
with check (private.has_capability(studio_id, 'settings.write'));
create policy locations_settings_update
on public.studio_locations
for update
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));
create policy locations_settings_delete
on public.studio_locations
for delete
to authenticated
using (private.has_capability(studio_id, 'settings.write'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_accounts (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  return new;
end;
$$;
