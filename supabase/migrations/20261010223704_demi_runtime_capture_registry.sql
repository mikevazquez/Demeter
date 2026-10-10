-- Empty runtime marker registry; no fixtures, fixture RPCs, or seed data.
-- The production manifest applies this before Demi 2 runtime migrations.
-- Sandbox already owns this table; leave its existing grants/policies intact.
do $registry$
begin
 if to_regclass('public.demi_uat_runs') is null then
  create table public.demi_uat_runs (
   id uuid primary key default gen_random_uuid(),
   source_studio_id uuid not null references public.studios(id),
   studio_id uuid not null unique references public.studios(id),
   owner_id uuid not null references auth.users(id),
   baseline jsonb not null,
   fixtures jsonb not null default '{}',
   faults jsonb not null default '{}',
   lease_until timestamptz,
   created_at timestamptz not null default clock_timestamp()
  );
  alter table public.demi_uat_runs enable row level security;
  revoke all on public.demi_uat_runs from public,anon,authenticated;
  grant select on public.demi_uat_runs to service_role;
 end if;
end;
$registry$;

