create type public.reward_rule_family as enum (
  'loyalty',
  'attendance',
  'challenge',
  'achievement'
);

create type public.reward_rule_status as enum (
  'draft',
  'scheduled',
  'active',
  'paused',
  'finished',
  'cancelled'
);

create type public.reward_participation_status as enum (
  'eligible',
  'in_progress',
  'fulfilled',
  'closed'
);

create type public.reward_cycle_status as enum (
  'open',
  'frozen',
  'fulfilled',
  'closed_incomplete',
  'cancelled'
);

create type public.reward_kind as enum (
  'percentage_discount',
  'fixed_discount',
  'credits',
  'validity_extension',
  'surcharge_waiver',
  'special_benefit',
  'badge',
  'custom_manual'
);

create type public.reward_instance_status as enum (
  'blocked',
  'available',
  'reserved',
  'redeemed',
  'expired',
  'revoked'
);

create type public.reward_incident_priority as enum ('normal', 'high', 'critical');

create type public.reward_incident_status as enum (
  'detected',
  'in_review',
  'resolved_automatic',
  'resolved_manual',
  'no_action_required',
  'closed'
);

insert into public.capabilities(key, description) values
  ('rewards.read', 'Consultar reglas, progreso y recompensas del estudio'),
  ('rewards.manage', 'Crear, versionar y administrar reglas y recompensas')
on conflict (key) do update set description = excluded.description;

insert into public.role_capabilities(role, capability_key) values
  ('owner', 'rewards.read'),
  ('owner', 'rewards.manage'),
  ('admin', 'rewards.read'),
  ('admin', 'rewards.manage')
on conflict do nothing;

create table public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  status public.reward_rule_status not null default 'draft',
  current_version_number integer not null default 1 check (current_version_number >= 1),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  first_activated_at timestamptz,
  last_activated_at timestamptz,
  paused_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_rules_studio_id_unique unique (studio_id, id),
  constraint reward_rules_schedule_order_chk check (
    scheduled_start_at is null
    or scheduled_end_at is null
    or scheduled_end_at >= scheduled_start_at
  ),
  constraint reward_rules_finished_at_chk check (status <> 'finished' or finished_at is not null),
  constraint reward_rules_cancelled_at_chk check (status <> 'cancelled' or cancelled_at is not null)
);

create table public.reward_rule_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null,
  version_number integer not null check (version_number >= 1),
  name text not null check (length(trim(name)) > 0),
  description text,
  family public.reward_rule_family not null,
  audience_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(audience_definition) = 'object'),
  condition_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(condition_definition) = 'object'),
  evaluation_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(evaluation_definition) = 'object'),
  cycle_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(cycle_definition) = 'object'),
  reward_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(reward_definition) = 'object'),
  presentation_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(presentation_definition) = 'object'),
  communication_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(communication_definition) = 'object'),
  incident_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(incident_definition) = 'object'),
  human_summary text not null check (length(trim(human_summary)) > 0),
  effective_from timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reward_rule_versions_rule_tenant_fkey
    foreign key (studio_id, rule_id) references public.reward_rules(studio_id, id) on delete cascade,
  constraint reward_rule_versions_rule_version_unique unique (rule_id, version_number),
  constraint reward_rule_versions_studio_id_unique unique (studio_id, id)
);

alter table public.reward_rules
  add constraint reward_rules_current_version_fkey
  foreign key (id, current_version_number)
  references public.reward_rule_versions(rule_id, version_number)
  deferrable initially deferred;

create index reward_rules_studio_status_idx
  on public.reward_rules(studio_id, status, updated_at desc);
create index reward_rule_versions_rule_idx
  on public.reward_rule_versions(studio_id, rule_id, version_number desc);

create table public.reward_rule_lifecycle (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null,
  operation text not null check (
    operation in ('created', 'version_created', 'scheduled', 'activated', 'paused', 'reactivated', 'finished', 'cancelled')
  ),
  from_status public.reward_rule_status,
  to_status public.reward_rule_status not null,
  version_number integer not null check (version_number >= 1),
  actor_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint reward_rule_lifecycle_rule_tenant_fkey
    foreign key (studio_id, rule_id) references public.reward_rules(studio_id, id) on delete cascade,
  constraint reward_rule_lifecycle_rule_version_fkey
    foreign key (rule_id, version_number) references public.reward_rule_versions(rule_id, version_number) on delete restrict
);

create index reward_rule_lifecycle_rule_created_idx
  on public.reward_rule_lifecycle(studio_id, rule_id, created_at, id);

create table public.reward_participations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  joined_version_number integer not null check (joined_version_number >= 1),
  status public.reward_participation_status not null default 'eligible',
  joined_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_participations_studio_id_unique unique (studio_id, id),
  constraint reward_participations_rule_student_unique unique (rule_id, student_id),
  constraint reward_participations_identity_unique unique (studio_id, id, rule_id, student_id),
  constraint reward_participations_rule_tenant_fkey
    foreign key (studio_id, rule_id) references public.reward_rules(studio_id, id) on delete restrict,
  constraint reward_participations_joined_version_fkey
    foreign key (rule_id, joined_version_number) references public.reward_rule_versions(rule_id, version_number) on delete restrict,
  constraint reward_participations_fulfilled_at_chk check (status <> 'fulfilled' or fulfilled_at is not null),
  constraint reward_participations_closed_at_chk check (status <> 'closed' or closed_at is not null)
);

create index reward_participations_student_idx
  on public.reward_participations(studio_id, student_id, status, updated_at desc);
create index reward_participations_rule_idx
  on public.reward_participations(studio_id, rule_id, status, updated_at desc);

create table public.reward_cycles (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  participation_id uuid not null,
  rule_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  cycle_key text not null check (length(trim(cycle_key)) > 0),
  status public.reward_cycle_status not null default 'open',
  window_start_at timestamptz,
  window_end_at timestamptz,
  frozen_at timestamptz,
  fulfilled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_cycles_studio_id_unique unique (studio_id, id),
  constraint reward_cycles_participation_key_unique unique (participation_id, cycle_key),
  constraint reward_cycles_window_order_chk check (
    window_start_at is null or window_end_at is null or window_end_at >= window_start_at
  ),
  constraint reward_cycles_participation_identity_fkey
    foreign key (studio_id, participation_id, rule_id, student_id)
    references public.reward_participations(studio_id, id, rule_id, student_id)
    on delete cascade,
  constraint reward_cycles_rule_version_fkey
    foreign key (rule_id, version_number) references public.reward_rule_versions(rule_id, version_number) on delete restrict,
  constraint reward_cycles_frozen_at_chk check (status <> 'frozen' or frozen_at is not null),
  constraint reward_cycles_fulfilled_at_chk check (status <> 'fulfilled' or fulfilled_at is not null),
  constraint reward_cycles_closed_at_chk check (
    status not in ('closed_incomplete', 'cancelled') or closed_at is not null
  )
);

create index reward_cycles_student_idx
  on public.reward_cycles(studio_id, student_id, status, window_end_at);
create index reward_cycles_rule_idx
  on public.reward_cycles(studio_id, rule_id, status, window_end_at);

create table public.reward_progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  cycle_id uuid not null,
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  evidence_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_summary) = 'object'),
  source_through timestamptz,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_progress_snapshots_cycle_tenant_fkey
    foreign key (studio_id, cycle_id) references public.reward_cycles(studio_id, id) on delete cascade
);

comment on table public.reward_progress_snapshots is
  'SF-234 append-only performance snapshots. Operational attendance, packages, sales and domain events remain the source of truth.';

create index reward_progress_snapshots_cycle_idx
  on public.reward_progress_snapshots(studio_id, cycle_id, calculated_at desc, id desc);

create table public.reward_instances (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete cascade,
  rule_id uuid,
  version_number integer,
  cycle_id uuid,
  kind public.reward_kind not null,
  status public.reward_instance_status not null default 'blocked',
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  benefit_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(benefit_definition) = 'object'),
  origin_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(origin_snapshot) = 'object'),
  available_from timestamptz,
  expires_at timestamptz,
  reserved_at timestamptz,
  reserved_until timestamptz,
  reservation_context jsonb not null default '{}'::jsonb check (jsonb_typeof(reservation_context) = 'object'),
  redeemed_at timestamptz,
  redemption_context jsonb not null default '{}'::jsonb check (jsonb_typeof(redemption_context) = 'object'),
  revoked_at timestamptz,
  revoked_reason text,
  manually_granted boolean not null default false,
  manual_reason text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_instances_studio_id_unique unique (studio_id, id),
  constraint reward_instances_idempotency_unique unique (studio_id, idempotency_key),
  constraint reward_instances_rule_tenant_fkey
    foreign key (studio_id, rule_id) references public.reward_rules(studio_id, id) on delete restrict,
  constraint reward_instances_rule_version_fkey
    foreign key (rule_id, version_number) references public.reward_rule_versions(rule_id, version_number) on delete restrict,
  constraint reward_instances_cycle_tenant_fkey
    foreign key (studio_id, cycle_id) references public.reward_cycles(studio_id, id) on delete restrict,
  constraint reward_instances_rule_version_pair_chk check (
    (rule_id is null and version_number is null) or (rule_id is not null and version_number is not null)
  ),
  constraint reward_instances_system_origin_chk check (
    manually_granted or (rule_id is not null and version_number is not null)
  ),
  constraint reward_instances_manual_reason_chk check (
    not manually_granted or length(trim(coalesce(manual_reason, ''))) > 0
  ),
  constraint reward_instances_availability_order_chk check (
    available_from is null or expires_at is null or expires_at >= available_from
  ),
  constraint reward_instances_reservation_order_chk check (
    reserved_at is null or reserved_until is null or reserved_until >= reserved_at
  ),
  constraint reward_instances_available_at_chk check (
    status not in ('available', 'reserved', 'redeemed') or available_from is not null
  ),
  constraint reward_instances_reserved_at_chk check (status <> 'reserved' or reserved_at is not null),
  constraint reward_instances_redeemed_at_chk check (status <> 'redeemed' or redeemed_at is not null),
  constraint reward_instances_expired_at_chk check (status <> 'expired' or expires_at is not null),
  constraint reward_instances_revoked_at_chk check (
    status <> 'revoked' or (revoked_at is not null and length(trim(coalesce(revoked_reason, ''))) > 0)
  )
);

comment on table public.reward_instances is
  'SF-234 frozen benefit definition plus mutable lifecycle state. Rule changes never rewrite an already generated reward.';

create index reward_instances_student_status_idx
  on public.reward_instances(studio_id, student_id, status, expires_at, created_at desc);
create index reward_instances_rule_idx
  on public.reward_instances(studio_id, rule_id, created_at desc) where rule_id is not null;

create table public.reward_instance_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  reward_instance_id uuid not null,
  event_type text not null check (
    event_type in ('created', 'unlocked', 'reserved', 'released', 'redeemed', 'auto_applied', 'expired', 'revoked', 'adjusted')
  ),
  from_status public.reward_instance_status,
  to_status public.reward_instance_status not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_instance_events_reward_tenant_fkey
    foreign key (studio_id, reward_instance_id) references public.reward_instances(studio_id, id) on delete restrict
);

create index reward_instance_events_reward_idx
  on public.reward_instance_events(studio_id, reward_instance_id, occurred_at, id);

create table public.reward_incidents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  student_id uuid references public.students(id) on delete set null,
  rule_id uuid,
  reward_instance_id uuid,
  incident_type text not null check (length(trim(incident_type)) > 0),
  priority public.reward_incident_priority not null default 'normal',
  status public.reward_incident_status not null default 'detected',
  summary text not null check (length(trim(summary)) > 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  resolution jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution) = 'object'),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_incidents_studio_id_unique unique (studio_id, id),
  constraint reward_incidents_rule_tenant_fkey
    foreign key (studio_id, rule_id) references public.reward_rules(studio_id, id) on delete restrict,
  constraint reward_incidents_reward_tenant_fkey
    foreign key (studio_id, reward_instance_id) references public.reward_instances(studio_id, id) on delete restrict,
  constraint reward_incidents_closed_at_chk check (status <> 'closed' or closed_at is not null)
);

create index reward_incidents_status_idx
  on public.reward_incidents(studio_id, status, priority, opened_at desc);

create table public.reward_incident_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  incident_id uuid not null,
  from_status public.reward_incident_status,
  to_status public.reward_incident_status not null,
  action text not null check (length(trim(action)) > 0),
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_incident_events_incident_tenant_fkey
    foreign key (studio_id, incident_id) references public.reward_incidents(studio_id, id) on delete restrict
);

create index reward_incident_events_incident_idx
  on public.reward_incident_events(studio_id, incident_id, occurred_at, id);

create or replace function private.is_reward_student_self(p_studio_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.studio_id = p_studio_id
      and s.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_reward_student_self(uuid, uuid) from public, anon;
grant execute on function private.is_reward_student_self(uuid, uuid) to authenticated;

alter table public.reward_rules enable row level security;
alter table public.reward_rule_versions enable row level security;
alter table public.reward_rule_lifecycle enable row level security;
alter table public.reward_participations enable row level security;
alter table public.reward_cycles enable row level security;
alter table public.reward_progress_snapshots enable row level security;
alter table public.reward_instances enable row level security;
alter table public.reward_instance_events enable row level security;
alter table public.reward_incidents enable row level security;
alter table public.reward_incident_events enable row level security;

create policy reward_rules_read on public.reward_rules for select to authenticated
  using (private.has_capability(studio_id, 'rewards.read'));
create policy reward_rule_versions_read on public.reward_rule_versions for select to authenticated
  using (private.has_capability(studio_id, 'rewards.read'));
create policy reward_rule_lifecycle_read on public.reward_rule_lifecycle for select to authenticated
  using (private.has_capability(studio_id, 'rewards.read'));
create policy reward_participations_read on public.reward_participations for select to authenticated
  using (
    private.has_capability(studio_id, 'rewards.read')
    or private.is_reward_student_self(studio_id, student_id)
  );
create policy reward_cycles_read on public.reward_cycles for select to authenticated
  using (
    private.has_capability(studio_id, 'rewards.read')
    or private.is_reward_student_self(studio_id, student_id)
  );
create policy reward_progress_snapshots_read on public.reward_progress_snapshots for select to authenticated
  using (
    private.has_capability(studio_id, 'rewards.read')
    or exists (
      select 1
      from public.reward_cycles c
      where c.id = reward_progress_snapshots.cycle_id
        and c.studio_id = reward_progress_snapshots.studio_id
        and private.is_reward_student_self(c.studio_id, c.student_id)
    )
  );
create policy reward_instances_read on public.reward_instances for select to authenticated
  using (
    private.has_capability(studio_id, 'rewards.read')
    or private.is_reward_student_self(studio_id, student_id)
  );
create policy reward_instance_events_read on public.reward_instance_events for select to authenticated
  using (
    private.has_capability(studio_id, 'rewards.read')
    or exists (
      select 1
      from public.reward_instances r
      where r.id = reward_instance_events.reward_instance_id
        and r.studio_id = reward_instance_events.studio_id
        and private.is_reward_student_self(r.studio_id, r.student_id)
    )
  );
create policy reward_incidents_read on public.reward_incidents for select to authenticated
  using (private.has_capability(studio_id, 'rewards.read'));
create policy reward_incident_events_read on public.reward_incident_events for select to authenticated
  using (private.has_capability(studio_id, 'rewards.read'));

revoke all on table public.reward_rules from anon, authenticated, service_role;
revoke all on table public.reward_rule_versions from anon, authenticated, service_role;
revoke all on table public.reward_rule_lifecycle from anon, authenticated, service_role;
revoke all on table public.reward_participations from anon, authenticated, service_role;
revoke all on table public.reward_cycles from anon, authenticated, service_role;
revoke all on table public.reward_progress_snapshots from anon, authenticated, service_role;
revoke all on table public.reward_instances from anon, authenticated, service_role;
revoke all on table public.reward_instance_events from anon, authenticated, service_role;
revoke all on table public.reward_incidents from anon, authenticated, service_role;
revoke all on table public.reward_incident_events from anon, authenticated, service_role;

grant select on table public.reward_rules to authenticated, service_role;
grant select on table public.reward_rule_versions to authenticated, service_role;
grant select on table public.reward_rule_lifecycle to authenticated, service_role;
grant select on table public.reward_participations to authenticated, service_role;
grant select on table public.reward_cycles to authenticated, service_role;
grant select on table public.reward_progress_snapshots to authenticated, service_role;
grant select on table public.reward_instances to authenticated, service_role;
grant select on table public.reward_instance_events to authenticated, service_role;
grant select on table public.reward_incidents to authenticated, service_role;
grant select on table public.reward_incident_events to authenticated, service_role;

create or replace function private.reject_reward_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'reward_history_immutable';
end;
$$;

revoke all on function private.reject_reward_history_mutation()
from public, anon, authenticated, service_role;

create trigger reward_rule_versions_immutable
before update or delete on public.reward_rule_versions
for each row execute function private.reject_reward_history_mutation();

create trigger reward_rule_lifecycle_immutable
before update or delete on public.reward_rule_lifecycle
for each row execute function private.reject_reward_history_mutation();

create trigger reward_progress_snapshots_immutable
before update or delete on public.reward_progress_snapshots
for each row execute function private.reject_reward_history_mutation();

create trigger reward_instance_events_immutable
before update or delete on public.reward_instance_events
for each row execute function private.reject_reward_history_mutation();

create trigger reward_incident_events_immutable
before update or delete on public.reward_incident_events
for each row execute function private.reject_reward_history_mutation();
