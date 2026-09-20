
create type public.reward_program_status as enum (
  'draft',
  'active',
  'paused',
  'archived'
);

create type public.reward_program_progression_mode as enum (
  'cumulative',
  'sequential'
);

create type public.reward_program_level_visibility as enum (
  'visible',
  'hidden'
);

create type public.reward_program_reward_visibility as enum (
  'visible',
  'surprise'
);

create type public.reward_program_participation_status as enum (
  'active',
  'completed',
  'closed'
);

create table public.reward_programs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  status public.reward_program_status not null default 'draft',
  latest_version_number integer not null default 1 check (latest_version_number >= 1),
  published_version_number integer,
  first_published_at timestamptz,
  last_published_at timestamptz,
  paused_at timestamptz,
  archived_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_programs_studio_id_unique unique (studio_id, id),
  constraint reward_programs_published_version_chk check (
    published_version_number is null
    or (
      published_version_number >= 1
      and published_version_number <= latest_version_number
    )
  ),
  constraint reward_programs_active_version_chk check (
    status not in ('active', 'paused')
    or published_version_number is not null
  ),
  constraint reward_programs_paused_at_chk check (
    status <> 'paused' or paused_at is not null
  ),
  constraint reward_programs_archived_at_chk check (
    status <> 'archived' or archived_at is not null
  )
);

create table public.reward_program_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  program_id uuid not null,
  version_number integer not null check (version_number >= 1),
  name text not null check (length(trim(name)) > 0),
  description text,
  progression_mode public.reward_program_progression_mode not null,
  audience_definition jsonb not null default
    '{"scope":"all_active_students","eligibility_mode":"continuous"}'::jsonb
    check (jsonb_typeof(audience_definition) = 'object'),
  presentation_definition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(presentation_definition) = 'object'),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reward_program_versions_program_tenant_fkey
    foreign key (studio_id, program_id)
    references public.reward_programs(studio_id, id)
    on delete cascade,
  constraint reward_program_versions_program_version_unique
    unique (program_id, version_number),
  constraint reward_program_versions_studio_id_unique
    unique (studio_id, id)
);

alter table public.reward_programs
  add constraint reward_programs_published_version_fkey
  foreign key (id, published_version_number)
  references public.reward_program_versions(program_id, version_number)
  deferrable initially deferred;

create table public.reward_program_levels (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  program_id uuid not null,
  program_version_number integer not null check (program_version_number >= 1),
  level_key text not null check (length(trim(level_key)) > 0),
  level_order integer not null check (level_order >= 1),
  title text not null check (length(trim(title)) > 0),
  description text,
  rule_id uuid not null,
  rule_version_number integer not null check (rule_version_number >= 1),
  level_visibility public.reward_program_level_visibility not null default 'visible',
  reward_visibility public.reward_program_reward_visibility not null default 'visible',
  presentation_definition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(presentation_definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_program_levels_program_version_fkey
    foreign key (program_id, program_version_number)
    references public.reward_program_versions(program_id, version_number)
    on delete cascade,
  constraint reward_program_levels_rule_version_fkey
    foreign key (rule_id, rule_version_number)
    references public.reward_rule_versions(rule_id, version_number)
    on delete restrict,
  constraint reward_program_levels_program_key_unique
    unique (program_id, program_version_number, level_key),
  constraint reward_program_levels_program_order_unique
    unique (program_id, program_version_number, level_order),
  constraint reward_program_levels_studio_id_unique
    unique (studio_id, id)
);

create table public.reward_program_lifecycle (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  program_id uuid not null,
  operation text not null check (
    operation in (
      'created',
      'version_created',
      'published',
      'paused',
      'resumed',
      'archived'
    )
  ),
  from_status public.reward_program_status,
  to_status public.reward_program_status not null,
  version_number integer,
  actor_user_id uuid references auth.users(id) on delete set null,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_program_lifecycle_program_tenant_fkey
    foreign key (studio_id, program_id)
    references public.reward_programs(studio_id, id)
    on delete cascade,
  constraint reward_program_lifecycle_version_fkey
    foreign key (program_id, version_number)
    references public.reward_program_versions(program_id, version_number)
    on delete restrict
);

create table public.reward_program_participations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  program_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  program_version_number integer not null check (program_version_number >= 1),
  status public.reward_program_participation_status not null default 'active',
  current_level_order integer,
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_program_participations_studio_id_unique unique (studio_id, id),
  constraint reward_program_participations_program_student_unique
    unique (program_id, student_id),
  constraint reward_program_participations_identity_unique
    unique (studio_id, id, program_id, student_id),
  constraint reward_program_participations_program_tenant_fkey
    foreign key (studio_id, program_id)
    references public.reward_programs(studio_id, id)
    on delete restrict,
  constraint reward_program_participations_program_version_fkey
    foreign key (program_id, program_version_number)
    references public.reward_program_versions(program_id, version_number)
    on delete restrict,
  constraint reward_program_participations_completed_at_chk check (
    status <> 'completed' or completed_at is not null
  ),
  constraint reward_program_participations_closed_at_chk check (
    status <> 'closed' or closed_at is not null
  )
);

create table public.reward_program_level_unlocks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  participation_id uuid not null,
  program_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  program_version_number integer not null check (program_version_number >= 1),
  level_id uuid not null,
  level_key_snapshot text not null check (length(trim(level_key_snapshot)) > 0),
  level_order_snapshot integer not null check (level_order_snapshot >= 1),
  title_snapshot text not null check (length(trim(title_snapshot)) > 0),
  source_evaluation_id uuid references public.reward_progress_evaluations(id) on delete restrict,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  unlocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_program_level_unlocks_participation_identity_fkey
    foreign key (studio_id, participation_id, program_id, student_id)
    references public.reward_program_participations(studio_id, id, program_id, student_id)
    on delete restrict,
  constraint reward_program_level_unlocks_program_version_fkey
    foreign key (program_id, program_version_number)
    references public.reward_program_versions(program_id, version_number)
    on delete restrict,
  constraint reward_program_level_unlocks_level_fkey
    foreign key (studio_id, level_id)
    references public.reward_program_levels(studio_id, id)
    on delete restrict,
  constraint reward_program_level_unlocks_idempotency_unique
    unique (studio_id, idempotency_key),
  constraint reward_program_level_unlocks_logical_unique
    unique (program_id, student_id, level_key_snapshot)
);

create table public.reward_program_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  program_id uuid not null,
  participation_id uuid,
  student_id uuid references public.students(id) on delete cascade,
  program_version_number integer not null check (program_version_number >= 1),
  level_id uuid,
  event_type text not null check (
    event_type in (
      'joined',
      'version_assigned',
      'level_started',
      'level_completed',
      'program_completed',
      'closed'
    )
  ),
  source_evaluation_id uuid references public.reward_progress_evaluations(id) on delete restrict,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_program_events_program_tenant_fkey
    foreign key (studio_id, program_id)
    references public.reward_programs(studio_id, id)
    on delete restrict,
  constraint reward_program_events_program_version_fkey
    foreign key (program_id, program_version_number)
    references public.reward_program_versions(program_id, version_number)
    on delete restrict,
  constraint reward_program_events_level_fkey
    foreign key (studio_id, level_id)
    references public.reward_program_levels(studio_id, id)
    on delete restrict,
  constraint reward_program_events_participation_fkey
    foreign key (studio_id, participation_id, program_id, student_id)
    references public.reward_program_participations(studio_id, id, program_id, student_id)
    on delete restrict
);

comment on table public.reward_programs is
  'SF-251 stable identity and lifecycle for configurable Progress & Rewards programs.';
comment on table public.reward_program_versions is
  'SF-251 published program configuration snapshots. Draft versions may be replaced before publication; published versions are immutable.';
comment on table public.reward_program_levels is
  'SF-251 ordered program levels. Each level delegates progress calculation to an immutable reward rule version.';
comment on table public.reward_program_participations is
  'SF-251 one stable participation per program/student. Program version assignment changes only on explicit publication.';
comment on table public.reward_program_level_unlocks is
  'SF-251 permanent level achievements. Published history is never rewritten by later program edits.';
comment on table public.reward_program_events is
  'SF-251 append-only student journey events for programs and levels.';

create index reward_programs_studio_status_idx
  on public.reward_programs(studio_id, status, updated_at desc);

create index reward_program_versions_program_idx
  on public.reward_program_versions(studio_id, program_id, version_number desc);

create index reward_program_levels_program_idx
  on public.reward_program_levels(
    studio_id,
    program_id,
    program_version_number,
    level_order
  );

create index reward_program_levels_rule_idx
  on public.reward_program_levels(studio_id, rule_id, rule_version_number);

create index reward_program_lifecycle_program_idx
  on public.reward_program_lifecycle(studio_id, program_id, occurred_at desc, id desc);

create index reward_program_participations_student_idx
  on public.reward_program_participations(
    studio_id,
    student_id,
    status,
    updated_at desc
  );

create index reward_program_participations_program_idx
  on public.reward_program_participations(
    studio_id,
    program_id,
    status,
    updated_at desc
  );

create index reward_program_level_unlocks_student_idx
  on public.reward_program_level_unlocks(
    studio_id,
    student_id,
    unlocked_at desc,
    id desc
  );

create index reward_program_level_unlocks_program_idx
  on public.reward_program_level_unlocks(
    studio_id,
    program_id,
    student_id,
    level_order_snapshot
  );

create index reward_program_events_student_idx
  on public.reward_program_events(
    studio_id,
    student_id,
    occurred_at desc,
    id desc
  );

create index reward_program_events_program_idx
  on public.reward_program_events(
    studio_id,
    program_id,
    occurred_at desc,
    id desc
  );

alter table public.reward_programs enable row level security;
alter table public.reward_program_versions enable row level security;
alter table public.reward_program_levels enable row level security;
alter table public.reward_program_lifecycle enable row level security;
alter table public.reward_program_participations enable row level security;
alter table public.reward_program_level_unlocks enable row level security;
alter table public.reward_program_events enable row level security;

create policy reward_programs_read
on public.reward_programs
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or exists (
    select 1
    from public.reward_program_participations p
    where p.program_id = reward_programs.id
      and p.studio_id = reward_programs.studio_id
      and private.is_reward_student_self(p.studio_id, p.student_id)
  )
  or exists (
    select 1
    from public.reward_program_level_unlocks u
    where u.program_id = reward_programs.id
      and u.studio_id = reward_programs.studio_id
      and private.is_reward_student_self(u.studio_id, u.student_id)
  )
);

create policy reward_program_versions_read
on public.reward_program_versions
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or exists (
    select 1
    from public.reward_program_participations p
    where p.program_id = reward_program_versions.program_id
      and p.program_version_number = reward_program_versions.version_number
      and p.studio_id = reward_program_versions.studio_id
      and private.is_reward_student_self(p.studio_id, p.student_id)
  )
  or exists (
    select 1
    from public.reward_program_level_unlocks u
    where u.program_id = reward_program_versions.program_id
      and u.program_version_number = reward_program_versions.version_number
      and u.studio_id = reward_program_versions.studio_id
      and private.is_reward_student_self(u.studio_id, u.student_id)
  )
);

create policy reward_program_levels_read
on public.reward_program_levels
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or exists (
    select 1
    from public.reward_program_participations p
    where p.program_id = reward_program_levels.program_id
      and p.program_version_number = reward_program_levels.program_version_number
      and p.studio_id = reward_program_levels.studio_id
      and private.is_reward_student_self(p.studio_id, p.student_id)
  )
  or exists (
    select 1
    from public.reward_program_level_unlocks u
    where u.level_id = reward_program_levels.id
      and u.studio_id = reward_program_levels.studio_id
      and private.is_reward_student_self(u.studio_id, u.student_id)
  )
);

create policy reward_program_lifecycle_read
on public.reward_program_lifecycle
for select
to authenticated
using (private.has_capability(studio_id, 'rewards.read'));

create policy reward_program_participations_read
on public.reward_program_participations
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

create policy reward_program_level_unlocks_read
on public.reward_program_level_unlocks
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

create policy reward_program_events_read
on public.reward_program_events
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or (
    student_id is not null
    and private.is_reward_student_self(studio_id, student_id)
  )
);

create or replace function private.guard_reward_program_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published integer;
begin
  select p.published_version_number
    into v_published
  from public.reward_programs p
  where p.id = old.program_id;

  if v_published = old.version_number then
    raise exception 'reward_program_published_version_immutable';
  end if;

  if tg_op = 'UPDATE'
     and (
       new.program_id <> old.program_id
       or new.version_number <> old.version_number
       or new.studio_id <> old.studio_id
     ) then
    raise exception 'reward_program_draft_version_identity_immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function private.guard_reward_program_level_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published integer;
begin
  select p.published_version_number
    into v_published
  from public.reward_programs p
  where p.id = old.program_id;

  if v_published = old.program_version_number then
    raise exception 'reward_program_published_level_immutable';
  end if;

  if tg_op = 'UPDATE'
     and (
       new.program_id <> old.program_id
       or new.program_version_number <> old.program_version_number
       or new.studio_id <> old.studio_id
     ) then
    raise exception 'reward_program_draft_level_identity_immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_reward_program_version_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.guard_reward_program_level_mutation()
from public, anon, authenticated, service_role;

create trigger reward_program_versions_guard
before update or delete on public.reward_program_versions
for each row execute function private.guard_reward_program_version_mutation();

create trigger reward_program_levels_guard
before update or delete on public.reward_program_levels
for each row execute function private.guard_reward_program_level_mutation();

create trigger reward_program_lifecycle_immutable
before update or delete on public.reward_program_lifecycle
for each row execute function private.reject_reward_history_mutation();

create trigger reward_program_level_unlocks_immutable
before update or delete on public.reward_program_level_unlocks
for each row execute function private.reject_reward_history_mutation();

create trigger reward_program_events_immutable
before update or delete on public.reward_program_events
for each row execute function private.reject_reward_history_mutation();

revoke all on table public.reward_programs from anon;
revoke all on table public.reward_program_versions from anon;
revoke all on table public.reward_program_levels from anon;
revoke all on table public.reward_program_lifecycle from anon;
revoke all on table public.reward_program_participations from anon;
revoke all on table public.reward_program_level_unlocks from anon;
revoke all on table public.reward_program_events from anon;

grant select on table public.reward_programs to authenticated;
grant select on table public.reward_program_versions to authenticated;
grant select on table public.reward_program_levels to authenticated;
grant select on table public.reward_program_lifecycle to authenticated;
grant select on table public.reward_program_participations to authenticated;
grant select on table public.reward_program_level_unlocks to authenticated;
grant select on table public.reward_program_events to authenticated;

grant all on table public.reward_programs to service_role;
grant all on table public.reward_program_versions to service_role;
grant all on table public.reward_program_levels to service_role;
grant all on table public.reward_program_lifecycle to service_role;
grant all on table public.reward_program_participations to service_role;
grant all on table public.reward_program_level_unlocks to service_role;
grant all on table public.reward_program_events to service_role;
