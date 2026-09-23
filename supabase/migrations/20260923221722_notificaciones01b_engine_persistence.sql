-- NOTIFICACIONES-01B · Notification Engine persistence.
-- Channel-agnostic core: events -> rules -> logical notifications -> per-channel jobs -> attempts.

create table public.notification_channels (
  channel_key text primary key,
  display_name text not null,
  is_active boolean not null default true,
  supports_delivery_receipts boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_channels_key_chk check (length(trim(channel_key)) > 0),
  constraint notification_channels_display_name_chk check (length(trim(display_name)) > 0)
);

insert into public.notification_channels (
  channel_key, display_name, is_active, supports_delivery_receipts
) values
  ('push', 'Push', true, false),
  ('whatsapp', 'WhatsApp', true, true),
  ('email', 'Email', true, true),
  ('inbox', 'Inbox', true, true);

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_key text not null,
  event_type text not null,
  enabled boolean not null default false,
  current_version_number integer not null default 1,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint notification_rules_rule_key_chk check (length(trim(rule_key)) > 0),
  constraint notification_rules_event_type_chk check (length(trim(event_type)) > 0),
  constraint notification_rules_version_chk check (current_version_number > 0),
  unique (studio_id, rule_key),
  unique (studio_id, id)
);

create table public.notification_rule_versions (
  studio_id uuid not null,
  rule_id uuid not null,
  version_number integer not null,
  notification_type text not null,
  priority text not null,
  recipient_strategy_key text not null,
  conditions jsonb not null default '{}'::jsonb,
  timing_strategy_key text not null,
  timing_config jsonb not null default '{}'::jsonb,
  revalidation_strategy_key text,
  template_key text not null,
  expires_after_seconds integer,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  primary key (rule_id, version_number),
  unique (studio_id, rule_id, version_number),
  constraint notification_rule_versions_rule_tenant_fkey
    foreign key (studio_id, rule_id)
    references public.notification_rules(studio_id, id)
    on delete cascade,
  constraint notification_rule_versions_version_chk check (version_number > 0),
  constraint notification_rule_versions_type_chk check (length(trim(notification_type)) > 0),
  constraint notification_rule_versions_priority_chk check (priority in ('critical','normal','low')),
  constraint notification_rule_versions_recipient_strategy_chk check (length(trim(recipient_strategy_key)) > 0),
  constraint notification_rule_versions_conditions_chk check (jsonb_typeof(conditions) = 'object'),
  constraint notification_rule_versions_timing_strategy_chk check (length(trim(timing_strategy_key)) > 0),
  constraint notification_rule_versions_timing_config_chk check (jsonb_typeof(timing_config) = 'object'),
  constraint notification_rule_versions_revalidation_strategy_chk
    check (revalidation_strategy_key is null or length(trim(revalidation_strategy_key)) > 0),
  constraint notification_rule_versions_template_key_chk check (length(trim(template_key)) > 0),
  constraint notification_rule_versions_expiry_chk check (expires_after_seconds is null or expires_after_seconds > 0)
);

create table public.notification_rule_channels (
  studio_id uuid not null,
  rule_id uuid not null,
  version_number integer not null,
  channel_key text not null references public.notification_channels(channel_key) on delete restrict,
  is_required boolean not null default true,
  ordinal integer not null default 0,
  channel_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (rule_id, version_number, channel_key),
  constraint notification_rule_channels_version_tenant_fkey
    foreign key (studio_id, rule_id, version_number)
    references public.notification_rule_versions(studio_id, rule_id, version_number)
    on delete cascade,
  constraint notification_rule_channels_ordinal_chk check (ordinal >= 0),
  constraint notification_rule_channels_policy_chk check (jsonb_typeof(channel_policy) = 'object')
);

create table public.notification_event_processings (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  event_id uuid not null,
  engine_key text not null default 'notification_engine:v1',
  state text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 10,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  rules_evaluated integer not null default 0,
  notifications_created integer not null default 0,
  notifications_suppressed integer not null default 0,
  jobs_created integer not null default 0,
  duplicates_skipped integer not null default 0,
  last_error_code text,
  last_error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint notification_event_processings_event_tenant_fkey
    foreign key (studio_id, event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint notification_event_processings_engine_chk check (length(trim(engine_key)) > 0),
  constraint notification_event_processings_state_chk check (state in ('pending','processing','completed','failed')),
  constraint notification_event_processings_attempt_chk check (attempt_count >= 0),
  constraint notification_event_processings_max_attempts_chk check (max_attempts > 0),
  constraint notification_event_processings_counts_chk check (
    rules_evaluated >= 0
    and notifications_created >= 0
    and notifications_suppressed >= 0
    and jobs_created >= 0
    and duplicates_skipped >= 0
  ),
  unique (event_id, engine_key),
  unique (studio_id, id)
);

create table public.notification_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  event_id uuid not null,
  rule_id uuid not null,
  rule_version_number integer not null,
  outcome text not null,
  reason_code text,
  details jsonb not null default '{}'::jsonb,
  recipient_count integer not null default 0,
  notifications_created integer not null default 0,
  evaluated_at timestamptz not null default now(),
  constraint notification_rule_evaluations_event_tenant_fkey
    foreign key (studio_id, event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint notification_rule_evaluations_rule_version_tenant_fkey
    foreign key (studio_id, rule_id, rule_version_number)
    references public.notification_rule_versions(studio_id, rule_id, version_number)
    on delete restrict,
  constraint notification_rule_evaluations_outcome_chk check (outcome in ('matched','not_matched','suppressed','error')),
  constraint notification_rule_evaluations_details_chk check (jsonb_typeof(details) = 'object'),
  constraint notification_rule_evaluations_counts_chk check (recipient_count >= 0 and notifications_created >= 0),
  unique (event_id, rule_id, rule_version_number),
  unique (studio_id, id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  source_event_id uuid not null,
  rule_id uuid not null,
  rule_version_number integer not null,
  notification_type text not null,
  recipient_type text not null,
  recipient_entity_id uuid,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_snapshot jsonb not null default '{}'::jsonb,
  priority text not null,
  state text not null default 'pending',
  scheduled_for timestamptz,
  expires_at timestamptz,
  template_key text not null,
  template_variables jsonb not null default '{}'::jsonb,
  deduplication_key text not null,
  state_reason_code text,
  state_reason_detail text,
  state_actor_type text not null default 'system',
  state_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  suppressed_at timestamptz,
  completed_at timestamptz,
  constraint notifications_source_event_tenant_fkey
    foreign key (studio_id, source_event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint notifications_rule_version_tenant_fkey
    foreign key (studio_id, rule_id, rule_version_number)
    references public.notification_rule_versions(studio_id, rule_id, version_number)
    on delete restrict,
  constraint notifications_type_chk check (length(trim(notification_type)) > 0),
  constraint notifications_recipient_type_chk check (length(trim(recipient_type)) > 0),
  constraint notifications_recipient_snapshot_chk check (jsonb_typeof(recipient_snapshot) = 'object'),
  constraint notifications_priority_chk check (priority in ('critical','normal','low')),
  constraint notifications_state_chk check (
    state in ('pending','scheduled','processing','partially_completed','completed','cancelled','suppressed','failed')
  ),
  constraint notifications_template_key_chk check (length(trim(template_key)) > 0),
  constraint notifications_template_variables_chk check (jsonb_typeof(template_variables) = 'object'),
  constraint notifications_dedup_chk check (length(trim(deduplication_key)) > 0),
  constraint notifications_state_actor_type_chk check (length(trim(state_actor_type)) > 0),
  unique (studio_id, deduplication_key),
  unique (studio_id, id)
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  notification_id uuid not null,
  channel_key text not null references public.notification_channels(channel_key) on delete restrict,
  is_required boolean not null default true,
  state text not null default 'pending',
  scheduled_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error_category text,
  last_error_code text,
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  channel_deduplication_key text not null,
  state_reason_code text,
  state_reason_detail text,
  state_actor_type text not null default 'system',
  state_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint notification_jobs_notification_tenant_fkey
    foreign key (studio_id, notification_id)
    references public.notifications(studio_id, id)
    on delete cascade,
  constraint notification_jobs_state_chk check (
    state in ('pending','scheduled','processing','sent','delivered','failed','retrying','cancelled','suppressed','expired')
  ),
  constraint notification_jobs_attempt_count_chk check (attempt_count >= 0),
  constraint notification_jobs_max_attempts_chk check (max_attempts > 0),
  constraint notification_jobs_dedup_chk check (length(trim(channel_deduplication_key)) > 0),
  constraint notification_jobs_state_actor_type_chk check (length(trim(state_actor_type)) > 0),
  unique (notification_id, channel_key),
  unique (studio_id, channel_deduplication_key),
  unique (studio_id, id)
);

create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null,
  state text not null default 'started',
  adapter_key text not null,
  provider_key text,
  provider_message_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  delivered_at timestamptz,
  http_status integer,
  error_category text,
  error_code text,
  error_message_safe text,
  provider_response_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_attempts_job_tenant_fkey
    foreign key (studio_id, job_id)
    references public.notification_jobs(studio_id, id)
    on delete cascade,
  constraint notification_attempts_attempt_number_chk check (attempt_number > 0),
  constraint notification_attempts_state_chk check (
    state in ('started','accepted','delivered','failed_transient','failed_permanent','timed_out')
  ),
  constraint notification_attempts_adapter_key_chk check (length(trim(adapter_key)) > 0),
  constraint notification_attempts_response_chk check (jsonb_typeof(provider_response_safe) = 'object'),
  unique (job_id, attempt_number),
  unique (studio_id, id)
);

create table public.notification_state_transitions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  notification_id uuid,
  job_id uuid,
  from_state text,
  to_state text not null,
  reason_code text,
  reason_detail text,
  actor_type text not null default 'system',
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint notification_state_transitions_notification_tenant_fkey
    foreign key (studio_id, notification_id)
    references public.notifications(studio_id, id)
    on delete cascade,
  constraint notification_state_transitions_job_tenant_fkey
    foreign key (studio_id, job_id)
    references public.notification_jobs(studio_id, id)
    on delete cascade,
  constraint notification_state_transitions_subject_chk check (num_nonnulls(notification_id, job_id) = 1),
  constraint notification_state_transitions_to_state_chk check (length(trim(to_state)) > 0),
  constraint notification_state_transitions_actor_type_chk check (length(trim(actor_type)) > 0)
);

create index notification_rules_active_event_idx
  on public.notification_rules(studio_id, event_type)
  where enabled and archived_at is null;
create index notification_rule_channels_lookup_idx
  on public.notification_rule_channels(studio_id, rule_id, version_number, ordinal);
create index notification_event_processings_ready_idx
  on public.notification_event_processings(state, available_at)
  where state in ('pending','failed');
create index notification_event_processings_lease_idx
  on public.notification_event_processings(lease_expires_at)
  where state = 'processing';
create index notification_event_processings_studio_event_idx
  on public.notification_event_processings(studio_id, event_id);
create index notification_rule_evaluations_event_idx
  on public.notification_rule_evaluations(studio_id, event_id, evaluated_at desc);
create index notifications_source_event_idx
  on public.notifications(studio_id, source_event_id);
create index notifications_recipient_user_idx
  on public.notifications(recipient_user_id, created_at desc)
  where recipient_user_id is not null;
create index notifications_rule_idx
  on public.notifications(studio_id, rule_id, rule_version_number);
create index notification_jobs_ready_idx
  on public.notification_jobs(state, available_at)
  where state in ('pending','scheduled','retrying');
create index notification_jobs_lease_idx
  on public.notification_jobs(lease_expires_at)
  where state = 'processing';
create index notification_jobs_notification_idx
  on public.notification_jobs(notification_id);
create index notification_attempts_job_idx
  on public.notification_attempts(job_id, attempt_number desc);
create index notification_state_transitions_notification_idx
  on public.notification_state_transitions(notification_id, created_at desc)
  where notification_id is not null;
create index notification_state_transitions_job_idx
  on public.notification_state_transitions(job_id, created_at desc)
  where job_id is not null;

-- Covering indexes for tenant-aware foreign keys.
create index notification_attempts_tenant_job_idx
  on public.notification_attempts(studio_id, job_id);
create index notification_jobs_channel_idx
  on public.notification_jobs(channel_key);
create index notification_jobs_tenant_notification_idx
  on public.notification_jobs(studio_id, notification_id);
create index notification_rule_channels_channel_idx
  on public.notification_rule_channels(channel_key);
create index notification_rule_evaluations_rule_version_idx
  on public.notification_rule_evaluations(studio_id, rule_id, rule_version_number);
create index notification_rule_versions_created_by_idx
  on public.notification_rule_versions(created_by_user_id)
  where created_by_user_id is not null;
create index notification_rules_created_by_idx
  on public.notification_rules(created_by_user_id)
  where created_by_user_id is not null;
create index notification_rules_updated_by_idx
  on public.notification_rules(updated_by_user_id)
  where updated_by_user_id is not null;
create index notification_state_transitions_tenant_notification_idx
  on public.notification_state_transitions(studio_id, notification_id)
  where notification_id is not null;
create index notification_state_transitions_tenant_job_idx
  on public.notification_state_transitions(studio_id, job_id)
  where job_id is not null;

alter table public.notification_channels enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_rule_versions enable row level security;
alter table public.notification_rule_channels enable row level security;
alter table public.notification_event_processings enable row level security;
alter table public.notification_rule_evaluations enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.notification_state_transitions enable row level security;

revoke all on table public.notification_channels from public, anon, authenticated;
revoke all on table public.notification_rules from public, anon, authenticated;
revoke all on table public.notification_rule_versions from public, anon, authenticated;
revoke all on table public.notification_rule_channels from public, anon, authenticated;
revoke all on table public.notification_event_processings from public, anon, authenticated;
revoke all on table public.notification_rule_evaluations from public, anon, authenticated;
revoke all on table public.notifications from public, anon, authenticated;
revoke all on table public.notification_jobs from public, anon, authenticated;
revoke all on table public.notification_attempts from public, anon, authenticated;
revoke all on table public.notification_state_transitions from public, anon, authenticated;

grant select, insert, update, delete on table public.notification_channels to service_role;
grant select, insert, update, delete on table public.notification_rules to service_role;
grant select, insert, update, delete on table public.notification_rule_versions to service_role;
grant select, insert, update, delete on table public.notification_rule_channels to service_role;
grant select, insert, update, delete on table public.notification_event_processings to service_role;
grant select, insert, update, delete on table public.notification_rule_evaluations to service_role;
grant select, insert, update, delete on table public.notifications to service_role;
grant select, insert, update, delete on table public.notification_jobs to service_role;
grant select, insert, update, delete on table public.notification_attempts to service_role;
grant select, insert, update, delete on table public.notification_state_transitions to service_role;
