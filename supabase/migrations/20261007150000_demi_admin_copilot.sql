create table if not exists public.assistant_admin_change_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  instruction text not null check (length(instruction) between 1 and 4000),
  summary text not null default '',
  plan jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','applied','rejected','failed')),
  error_code text,
  created_by uuid references auth.users(id),
  applied_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists assistant_admin_change_requests_studio_created_idx
  on public.assistant_admin_change_requests(studio_id, created_at desc);

create table if not exists public.assistant_admin_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  rule_key text not null check (length(rule_key) between 3 and 120),
  category text not null default 'behavior' check (category in ('behavior','commercial','booking','payment','communication','safety')),
  instruction text not null check (length(instruction) between 1 and 2000),
  enabled boolean not null default true,
  source_request_id uuid references public.assistant_admin_change_requests(id) on delete set null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(studio_id, rule_key)
);
create index if not exists assistant_admin_rules_runtime_idx
  on public.assistant_admin_rules(studio_id, enabled, category, updated_at desc);

alter table public.assistant_admin_change_requests enable row level security;
alter table public.assistant_admin_rules enable row level security;

revoke all on public.assistant_admin_change_requests from public, anon;
revoke all on public.assistant_admin_rules from public, anon;
grant select,insert,update on public.assistant_admin_change_requests to authenticated, service_role;
grant select,insert,update,delete on public.assistant_admin_rules to authenticated, service_role;

drop policy if exists assistant_admin_change_requests_admin on public.assistant_admin_change_requests;
create policy assistant_admin_change_requests_admin on public.assistant_admin_change_requests
  for all to authenticated
  using (private.has_capability(studio_id,'settings.write'))
  with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_admin_rules_admin on public.assistant_admin_rules;
create policy assistant_admin_rules_admin on public.assistant_admin_rules
  for all to authenticated
  using (private.has_capability(studio_id,'settings.write'))
  with check (private.has_capability(studio_id,'settings.write'));

grant select on public.assistant_admin_rules to service_role;
