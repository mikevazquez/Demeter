-- The installed assignment trigger depends on this audit relation.
create table if not exists public.studio_plan_assignment_events (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 from_plan_id uuid references public.saas_plans(id), to_plan_id uuid references public.saas_plans(id),
 from_status text, to_status text, actor_user_id uuid references auth.users(id),
 source text not null default 'platform', reason text, metadata jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists studio_plan_assignment_events_studio_time on public.studio_plan_assignment_events(studio_id,created_at);
alter table public.studio_plan_assignment_events enable row level security;
grant all on public.studio_plan_assignment_events to service_role;
