-- Demi / Studio Flow conversational assistant foundation.
-- Additive only. Asistian remains untouched.

create table if not exists public.assistant_configs (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  assistant_name text not null default 'Assistant',
  mode text not null default 'off' check (mode in ('off','demo','shadow','pilot','active')),
  model text not null default 'gpt-5.6-luna',
  reasoning_effort text not null default 'medium' check (reasoning_effort in ('none','low','medium','high')),
  personality_instructions text not null default '',
  monthly_budget_usd_micros bigint check (monthly_budget_usd_micros is null or monthly_budget_usd_micros >= 0),
  conversation_budget_usd_micros bigint check (conversation_budget_usd_micros is null or conversation_budget_usd_micros >= 0),
  max_model_calls_per_turn integer not null default 6 check (max_model_calls_per_turn between 1 and 20),
  max_tool_calls_per_turn integer not null default 8 check (max_tool_calls_per_turn between 1 and 30),
  auto_action_keys text[] not null default array[
    'read.availability','read.activities','read.commercial','read.studio_info',
    'read.policies','read.student_summary','crm.ensure_prospect','support.escalate'
  ]::text[],
  confirmation_action_keys text[] not null default array[
    'booking.create','booking.cancel','booking.reschedule','waitlist.join'
  ]::text[],
  escalation_action_keys text[] not null default array[
    'credits.grant','payments.modify','prices.modify','discounts.override',
    'policies.modify','admin.override'
  ]::text[],
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  channel text not null check (channel in ('internal_demo','whatsapp','asistian_shadow')),
  external_thread_ref text,
  crm_conversation_id uuid references public.crm_conversations(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  status text not null default 'open' check (status in ('open','escalated','closed')),
  context jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  last_activity_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, studio_id)
);

create unique index if not exists assistant_conversations_external_thread_idx
  on public.assistant_conversations(studio_id,channel,external_thread_ref)
  where external_thread_ref is not null;
create index if not exists assistant_conversations_studio_activity_idx
  on public.assistant_conversations(studio_id,last_activity_at desc);

create table if not exists public.assistant_turns (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound','outbound','system')),
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  sanitized boolean not null default true,
  channel_message_ref text,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, studio_id),
  constraint assistant_turns_conversation_fk
    foreign key (conversation_id,studio_id)
    references public.assistant_conversations(id,studio_id)
    on delete cascade
);
create index if not exists assistant_turns_conversation_created_idx
  on public.assistant_turns(studio_id,conversation_id,created_at);

create table if not exists public.assistant_model_calls (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null,
  turn_id uuid,
  model text not null,
  response_id text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  estimated_cost_usd_micros bigint not null default 0 check (estimated_cost_usd_micros >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  status text not null check (status in ('started','completed','error','budget_blocked')),
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  constraint assistant_model_calls_conversation_fk
    foreign key (conversation_id,studio_id)
    references public.assistant_conversations(id,studio_id)
    on delete cascade,
  constraint assistant_model_calls_turn_fk
    foreign key (turn_id,studio_id)
    references public.assistant_turns(id,studio_id)
    on delete set null
);
create index if not exists assistant_model_calls_studio_created_idx
  on public.assistant_model_calls(studio_id,created_at desc);

create table if not exists public.assistant_tool_executions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null,
  turn_id uuid,
  model_call_id uuid references public.assistant_model_calls(id) on delete set null,
  tool_call_id text not null,
  tool_name text not null,
  schema_version integer not null default 1 check (schema_version > 0),
  permission_class text not null check (permission_class in ('A','B','C')),
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('requested','prepared','executed','blocked','error')),
  idempotency_key text,
  affected_entity_type text,
  affected_entity_id uuid,
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default clock_timestamp(),
  constraint assistant_tool_executions_conversation_fk
    foreign key (conversation_id,studio_id)
    references public.assistant_conversations(id,studio_id)
    on delete cascade,
  constraint assistant_tool_executions_turn_fk
    foreign key (turn_id,studio_id)
    references public.assistant_turns(id,studio_id)
    on delete set null
);
create unique index if not exists assistant_tool_executions_idempotency_idx
  on public.assistant_tool_executions(studio_id,idempotency_key)
  where idempotency_key is not null;
create index if not exists assistant_tool_executions_trace_idx
  on public.assistant_tool_executions(studio_id,conversation_id,created_at);

create table if not exists public.assistant_pending_actions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null,
  action_type text not null check (action_type in ('booking.create','booking.cancel','booking.reschedule','waitlist.join')),
  action_token_hash text not null,
  action_payload jsonb not null,
  confirmation_summary jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','confirmed','executed','expired','cancelled')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  executed_at timestamptz,
  execution_ref text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint assistant_pending_actions_conversation_fk
    foreign key (conversation_id,studio_id)
    references public.assistant_conversations(id,studio_id)
    on delete cascade
);
create unique index if not exists assistant_pending_actions_token_idx
  on public.assistant_pending_actions(action_token_hash);
create index if not exists assistant_pending_actions_lookup_idx
  on public.assistant_pending_actions(studio_id,conversation_id,status,expires_at desc);

alter table public.assistant_configs enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_turns enable row level security;
alter table public.assistant_model_calls enable row level security;
alter table public.assistant_tool_executions enable row level security;
alter table public.assistant_pending_actions enable row level security;

revoke all on table public.assistant_configs from public, anon;
revoke all on table public.assistant_conversations from public, anon;
revoke all on table public.assistant_turns from public, anon;
revoke all on table public.assistant_model_calls from public, anon;
revoke all on table public.assistant_tool_executions from public, anon;
revoke all on table public.assistant_pending_actions from public, anon;

grant select,insert,update on table public.assistant_configs to authenticated;
grant select,insert,update on table public.assistant_conversations to authenticated;
grant select,insert on table public.assistant_turns to authenticated;
grant select,insert,update on table public.assistant_model_calls to authenticated;
grant select,insert,update on table public.assistant_tool_executions to authenticated;
grant select,insert,update on table public.assistant_pending_actions to authenticated;

grant select,insert,update,delete on table public.assistant_configs to service_role;
grant select,insert,update,delete on table public.assistant_conversations to service_role;
grant select,insert,update,delete on table public.assistant_turns to service_role;
grant select,insert,update,delete on table public.assistant_model_calls to service_role;
grant select,insert,update,delete on table public.assistant_tool_executions to service_role;
grant select,insert,update,delete on table public.assistant_pending_actions to service_role;

drop policy if exists assistant_configs_admin on public.assistant_configs;
create policy assistant_configs_admin on public.assistant_configs
for all to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_conversations_admin on public.assistant_conversations;
create policy assistant_conversations_admin on public.assistant_conversations
for all to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_turns_admin on public.assistant_turns;
create policy assistant_turns_admin on public.assistant_turns
for select to authenticated
using (private.has_capability(studio_id,'settings.write'));
drop policy if exists assistant_turns_admin_insert on public.assistant_turns;
create policy assistant_turns_admin_insert on public.assistant_turns
for insert to authenticated
with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_model_calls_admin on public.assistant_model_calls;
create policy assistant_model_calls_admin on public.assistant_model_calls
for all to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_tool_executions_admin on public.assistant_tool_executions;
create policy assistant_tool_executions_admin on public.assistant_tool_executions
for all to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));

drop policy if exists assistant_pending_actions_admin on public.assistant_pending_actions;
create policy assistant_pending_actions_admin on public.assistant_pending_actions
for all to authenticated
using (private.has_capability(studio_id,'settings.write'))
with check (private.has_capability(studio_id,'settings.write'));
