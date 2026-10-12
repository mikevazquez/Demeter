create table if not exists public.demi_temporary_information (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null check (length(title) between 2 and 160),
  kind text not null check (kind in ('workshop', 'promotion', 'event')),
  discipline text check (discipline is null or length(discipline) <= 120),
  details text not null check (length(details) between 1 and 5000),
  promotion_starts_on date not null,
  event_starts_on date not null,
  event_ends_on date not null,
  registration_deadline date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint demi_temporary_information_event_dates_check
    check (event_starts_on <= event_ends_on),
  constraint demi_temporary_information_promotion_date_check
    check (promotion_starts_on <= event_ends_on),
  constraint demi_temporary_information_registration_deadline_check
    check (
      registration_deadline is null
      or (
        registration_deadline >= promotion_starts_on
        and registration_deadline <= event_ends_on
      )
    )
);

comment on table public.demi_temporary_information is
  'Time-bounded workshop, event, and promotion facts Demi can answer from without changing the permanent prompt.';
comment on column public.demi_temporary_information.promotion_starts_on is
  'First local studio date when Demi may answer questions about this item.';
comment on column public.demi_temporary_information.registration_deadline is
  'Last local studio date when Demi may answer. Null means the event end date.';
comment on column public.demi_temporary_information.status is
  'Draft, published, or archived. Published records are still date-gated at runtime.';

create index if not exists demi_temporary_information_runtime_idx
  on public.demi_temporary_information (studio_id, status, promotion_starts_on, event_ends_on);

alter table public.demi_temporary_information enable row level security;

revoke all on public.demi_temporary_information from public, anon;
grant select, insert, update on public.demi_temporary_information to authenticated;
grant select on public.demi_temporary_information to service_role;

drop policy if exists demi_temporary_information_admin_read on public.demi_temporary_information;
create policy demi_temporary_information_admin_read
  on public.demi_temporary_information for select to authenticated
  using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists demi_temporary_information_admin_insert on public.demi_temporary_information;
create policy demi_temporary_information_admin_insert
  on public.demi_temporary_information for insert to authenticated
  with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists demi_temporary_information_admin_update on public.demi_temporary_information;
create policy demi_temporary_information_admin_update
  on public.demi_temporary_information for update to authenticated
  using (private.has_capability(studio_id, 'settings.write'))
  with check (private.has_capability(studio_id, 'settings.write'));

grant select on public.demi_temporary_information to service_role;
