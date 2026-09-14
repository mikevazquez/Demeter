create extension if not exists pgcrypto;

create type public.studio_role as enum ('owner','admin','coach','student');
create type public.session_status as enum ('scheduled','cancelled','completed');
create type public.reservation_status as enum ('booked','cancelled','attended','no_show');

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
  primary key (studio_id,user_id)
);

create table public.disciplines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (studio_id,name)
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
  unique (session_id,student_user_id)
);

create index studio_memberships_user_idx on public.studio_memberships(user_id,active);
create index class_sessions_studio_starts_at_idx on public.class_sessions(studio_id,starts_at);
create index reservations_student_idx on public.reservations(student_user_id,booked_at desc);
create index student_packages_student_idx on public.student_packages(student_user_id,expires_on);
