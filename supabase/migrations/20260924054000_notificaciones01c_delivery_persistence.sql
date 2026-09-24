-- NOTIFICACIONES-01C · Durable delivery persistence.
-- 01C starts only after a 01B notification_job is durably handed off.

alter table public.notification_jobs
  alter column state set default 'ready';

create table public.notification_channel_adapters (
  channel_key text primary key
    references public.notification_channels(channel_key) on delete cascade,
  adapter_key text not null,
  provider_key text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_channel_adapters_adapter_chk
    check (length(trim(adapter_key)) > 0)
);

insert into public.notification_channel_adapters (
  channel_key, adapter_key, provider_key, enabled
) values
  ('push', 'web_push', 'web_push', true),
  ('inbox', 'studio_flow_inbox', 'studio_flow', true),
  ('whatsapp', 'asistian', 'asistian', true),
  ('email', 'email_provider', null, false)
on conflict (channel_key) do update
set
  adapter_key = excluded.adapter_key,
  provider_key = excluded.provider_key,
  enabled = excluded.enabled,
  updated_at = clock_timestamp();

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  job_id uuid not null,
  notification_id uuid not null,
  source_event_id uuid not null,
  channel_key text not null,
  adapter_key text not null,
  adapter_enabled boolean not null default true,
  provider_key text,
  notification_type text not null,
  communication_class text not null,
  priority text not null,
  recipient_type text not null,
  recipient_entity_id uuid,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_snapshot jsonb not null default '{}'::jsonb,
  template_key text not null,
  template_variables jsonb not null default '{}'::jsonb,
  channel_policy jsonb not null default '{}'::jsonb,
  message_snapshot jsonb not null default '{}'::jsonb,
  state text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  expires_at timestamptz,
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error_category text,
  last_error_code text,
  last_error_safe text,
  handed_off_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_job_tenant_fkey
    foreign key (studio_id, job_id)
    references public.notification_jobs(studio_id, id)
    on delete cascade,
  constraint notification_deliveries_notification_tenant_fkey
    foreign key (studio_id, notification_id)
    references public.notifications(studio_id, id)
    on delete cascade,
  constraint notification_deliveries_event_tenant_fkey
    foreign key (studio_id, source_event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint notification_deliveries_channel_fkey
    foreign key (channel_key)
    references public.notification_channels(channel_key)
    on delete restrict,
  constraint notification_deliveries_state_chk
    check (state in (
      'pending',
      'processing',
      'accepted',
      'delivered',
      'retry_wait',
      'failed_permanent',
      'skipped',
      'expired'
    )),
  constraint notification_deliveries_class_chk
    check (communication_class in ('P0','P1','P2')),
  constraint notification_deliveries_priority_chk
    check (priority in ('critical','normal','low')),
  constraint notification_deliveries_attempt_chk
    check (attempt_count >= 0),
  constraint notification_deliveries_max_attempts_chk
    check (max_attempts between 1 and 10),
  constraint notification_deliveries_recipient_snapshot_chk
    check (jsonb_typeof(recipient_snapshot) = 'object'),
  constraint notification_deliveries_template_variables_chk
    check (jsonb_typeof(template_variables) = 'object'),
  constraint notification_deliveries_channel_policy_chk
    check (jsonb_typeof(channel_policy) = 'object'),
  constraint notification_deliveries_message_snapshot_chk
    check (jsonb_typeof(message_snapshot) = 'object'),
  unique (job_id),
  unique (studio_id, id)
);

create table public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  delivery_id uuid not null,
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
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_delivery_attempts_delivery_tenant_fkey
    foreign key (studio_id, delivery_id)
    references public.notification_deliveries(studio_id, id)
    on delete cascade,
  constraint notification_delivery_attempts_number_chk
    check (attempt_number > 0),
  constraint notification_delivery_attempts_state_chk
    check (state in (
      'started',
      'accepted',
      'delivered',
      'failed_transient',
      'failed_permanent',
      'skipped'
    )),
  constraint notification_delivery_attempts_adapter_chk
    check (length(trim(adapter_key)) > 0),
  constraint notification_delivery_attempts_response_chk
    check (jsonb_typeof(response_snapshot) = 'object'),
  unique (delivery_id, attempt_number),
  unique (studio_id, id)
);

create index notification_deliveries_ready_idx
  on public.notification_deliveries(state, available_at)
  where state in ('pending','retry_wait');

create index notification_deliveries_lease_idx
  on public.notification_deliveries(lease_expires_at)
  where state = 'processing';

create index notification_deliveries_notification_idx
  on public.notification_deliveries(notification_id);

create index notification_deliveries_recipient_user_idx
  on public.notification_deliveries(studio_id, recipient_user_id, created_at desc)
  where recipient_user_id is not null;

create index notification_delivery_attempts_delivery_idx
  on public.notification_delivery_attempts(delivery_id, attempt_number desc);

alter table public.notification_channel_adapters enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_delivery_attempts enable row level security;

revoke all on table public.notification_channel_adapters from public, anon, authenticated;
revoke all on table public.notification_deliveries from public, anon, authenticated;
revoke all on table public.notification_delivery_attempts from public, anon, authenticated;

grant select, insert, update, delete on table public.notification_channel_adapters to service_role;
grant select, insert, update, delete on table public.notification_deliveries to service_role;
grant select, insert, update, delete on table public.notification_delivery_attempts to service_role;
