-- Demeter / Studio Flow — initial clean schema
-- Multi-studio foundation with RLS enabled on every public table.

create extension if not exists pgcrypto;

create type public.studio_role as enum ('owner', 'admin', 'coach', 'student');
create type public.session_status as enum ('scheduled', 'cancelled', 'completed');
create type public.reservation_status as enum ('booked', 'cancelled', 'attended', 'no_show');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Mexico_City',
  currency text not null default 'MXN',
  created_at timestamptz not null default now()
);

create table public.studio_memberships (
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.studio_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);

create table public.disciplines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (studio_id, name)
);

create table public.class_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete restrict,
  name text not null,
  duration_minutes integer not null check (duration_minutes between 15 and 360),
  capacity integer not null check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_id uuid not null references public.class_templates(id) on delete restrict,
  coach_user_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  status public.session_status not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  class_credits integer check (class_credits is null or class_credits > 0),
  validity_days integer not null check (validity_days > 0),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.student_packages (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  credits_total integer,
  credits_remaining integer,
  starts_on date not null,
  expires_on date not null,
  created_at timestamptz not null default now(),
  check (expires_on >= starts_on),
  check (credits_total is null or credits_total > 0),
  check (credits_remaining is null or credits_remaining >= 0),
  check (credits_total is null or credits_remaining is null or credits_remaining <= credits_total)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  student_package_id uuid references public.student_packages(id) on delete set null,
  status public.reservation_status not null default 'booked',
  booked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_user_id)
);

create index studio_memberships_user_idx on public.studio_memberships(user_id, active);
create index class_sessions_studio_starts_at_idx on public.class_sessions(studio_id, starts_at);
create index reservations_student_idx on public.reservations(student_user_id, booked_at desc);
create index student_packages_student_idx on public.student_packages(student_user_id, expires_on);

alter table public.profiles enable row level security;
alter table public.studios enable row level security;
alter table public.studio_memberships enable row level security;
alter table public.disciplines enable row level security;
alter table public.class_templates enable row level security;
alter table public.class_sessions enable row level security;
alter table public.packages enable row level security;
alter table public.student_packages enable row level security;
alter table public.reservations enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_studio_member(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = target_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active
  );
$$;

create or replace function private.has_studio_role(target_studio_id uuid, allowed_roles public.studio_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = target_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active
      and sm.role = any(allowed_roles)
  );
$$;

revoke execute on function private.is_studio_member(uuid) from public, anon;
revoke execute on function private.has_studio_role(uuid, public.studio_role[]) from public, anon;
grant execute on function private.is_studio_member(uuid) to authenticated;
grant execute on function private.has_studio_role(uuid, public.studio_role[]) to authenticated;

create policy profiles_select_self on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy studios_member_select on public.studios for select to authenticated
  using ((select private.is_studio_member(id)));

create policy memberships_member_select on public.studio_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[]))
  );

create policy disciplines_member_select on public.disciplines for select to authenticated
  using ((select private.is_studio_member(studio_id)));
create policy templates_member_select on public.class_templates for select to authenticated
  using ((select private.is_studio_member(studio_id)));
create policy sessions_member_select on public.class_sessions for select to authenticated
  using ((select private.is_studio_member(studio_id)));
create policy packages_member_select on public.packages for select to authenticated
  using ((select private.is_studio_member(studio_id)));

create policy student_packages_select on public.student_packages for select to authenticated
  using (
    student_user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin','coach']::public.studio_role[]))
  );

create policy reservations_select on public.reservations for select to authenticated
  using (
    student_user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin','coach']::public.studio_role[]))
  );

-- Writes remain intentionally closed by RLS until the authenticated command flows
-- (admin CRUD, reservations, package credit handling) are implemented and tested.
