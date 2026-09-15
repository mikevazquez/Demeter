create table if not exists public.session_series (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_id uuid not null references public.class_templates(id) on delete restrict,
  instructor_id uuid references public.instructors(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  weekday smallint not null check (weekday between 0 and 6),
  local_time time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 360),
  capacity integer not null check (capacity > 0),
  starts_on date not null,
  ends_on date not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table public.class_sessions
  add column if not exists series_id uuid references public.session_series(id) on delete set null;

create index if not exists session_series_studio_idx on public.session_series(studio_id, active);
create index if not exists class_sessions_series_idx on public.class_sessions(series_id) where series_id is not null;

alter table public.session_series enable row level security;
grant select, insert, update, delete on public.session_series to authenticated;

create policy session_series_select on public.session_series for select to authenticated
  using (private.has_capability(studio_id, 'schedule.read'));
create policy session_series_write on public.session_series for all to authenticated
  using (private.has_capability(studio_id, 'schedule.write'))
  with check (private.has_capability(studio_id, 'schedule.write'));
