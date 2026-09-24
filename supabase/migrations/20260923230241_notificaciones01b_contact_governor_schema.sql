-- NOTIFICACIONES-01B · Contact Governor schema.
-- Separates communication class (P0/P1/P2) from delivery priority (critical/normal/low).

alter table public.notification_rule_versions
  add column communication_class text not null default 'P0',
  add constraint notification_rule_versions_communication_class_chk
    check (communication_class in ('P0','P1','P2'));

alter table public.notifications
  add column communication_class text not null default 'P0',
  add constraint notifications_communication_class_chk
    check (communication_class in ('P0','P1','P2'));

create table public.notification_contact_policies (
  studio_id uuid not null references public.studios(id) on delete cascade,
  communication_class text not null,
  cooldown_seconds integer not null default 0,
  max_per_24h integer,
  max_per_7d integer,
  collision_window_before_seconds integer not null default 0,
  collision_window_after_seconds integer not null default 0,
  on_higher_class_collision text not null default 'allow',
  defer_seconds integer not null default 0,
  respect_quiet_hours boolean not null default false,
  respect_marketing_preferences boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id, communication_class),
  constraint notification_contact_policies_class_chk
    check (communication_class in ('P0','P1','P2')),
  constraint notification_contact_policies_cooldown_chk
    check (cooldown_seconds >= 0),
  constraint notification_contact_policies_max_24h_chk
    check (max_per_24h is null or max_per_24h > 0),
  constraint notification_contact_policies_max_7d_chk
    check (max_per_7d is null or max_per_7d > 0),
  constraint notification_contact_policies_collision_before_chk
    check (collision_window_before_seconds >= 0),
  constraint notification_contact_policies_collision_after_chk
    check (collision_window_after_seconds >= 0),
  constraint notification_contact_policies_collision_action_chk
    check (on_higher_class_collision in ('allow','defer','suppress')),
  constraint notification_contact_policies_defer_chk
    check (defer_seconds >= 0)
);

create table public.notification_contact_decisions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  source_event_id uuid not null,
  rule_id uuid not null,
  rule_version_number integer not null,
  notification_id uuid,
  recipient_type text not null,
  recipient_entity_id uuid,
  recipient_user_id uuid references auth.users(id) on delete set null,
  communication_class text not null,
  phase text not null,
  outcome text not null,
  reason_code text not null,
  original_scheduled_for timestamptz not null,
  effective_scheduled_for timestamptz,
  policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_contact_decisions_event_tenant_fkey
    foreign key (studio_id, source_event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint notification_contact_decisions_rule_version_tenant_fkey
    foreign key (studio_id, rule_id, rule_version_number)
    references public.notification_rule_versions(studio_id, rule_id, version_number)
    on delete restrict,
  constraint notification_contact_decisions_notification_tenant_fkey
    foreign key (studio_id, notification_id)
    references public.notifications(studio_id, id)
    on delete cascade,
  constraint notification_contact_decisions_recipient_type_chk
    check (length(trim(recipient_type)) > 0),
  constraint notification_contact_decisions_recipient_identity_chk
    check (num_nonnulls(recipient_entity_id, recipient_user_id) >= 1),
  constraint notification_contact_decisions_class_chk
    check (communication_class in ('P0','P1','P2')),
  constraint notification_contact_decisions_phase_chk
    check (phase in ('materialization','pre_delivery')),
  constraint notification_contact_decisions_outcome_chk
    check (outcome in ('allow','defer','suppress')),
  constraint notification_contact_decisions_reason_chk
    check (length(trim(reason_code)) > 0),
  constraint notification_contact_decisions_policy_snapshot_chk
    check (jsonb_typeof(policy_snapshot) = 'object')
);

create index notification_contact_decisions_user_idx
  on public.notification_contact_decisions(studio_id, recipient_user_id, created_at desc)
  where recipient_user_id is not null;

create index notification_contact_decisions_entity_idx
  on public.notification_contact_decisions(studio_id, recipient_type, recipient_entity_id, created_at desc)
  where recipient_entity_id is not null;

create index notification_contact_decisions_notification_idx
  on public.notification_contact_decisions(notification_id, created_at desc)
  where notification_id is not null;

create index notification_contact_decisions_event_tenant_idx
  on public.notification_contact_decisions(studio_id, source_event_id);

create index notification_contact_decisions_notification_tenant_idx
  on public.notification_contact_decisions(studio_id, notification_id)
  where notification_id is not null;

create index notification_contact_decisions_recipient_user_fk_idx
  on public.notification_contact_decisions(recipient_user_id)
  where recipient_user_id is not null;

create index notification_contact_decisions_rule_version_tenant_idx
  on public.notification_contact_decisions(studio_id, rule_id, rule_version_number);

create index notifications_contact_user_idx
  on public.notifications(studio_id, communication_class, recipient_user_id, scheduled_for)
  where recipient_user_id is not null
    and state not in ('suppressed','cancelled','failed');

create index notifications_contact_entity_idx
  on public.notifications(studio_id, communication_class, recipient_type, recipient_entity_id, scheduled_for)
  where recipient_entity_id is not null
    and state not in ('suppressed','cancelled','failed');

alter table public.notification_contact_policies enable row level security;
alter table public.notification_contact_decisions enable row level security;

revoke all on table public.notification_contact_policies from public, anon, authenticated;
revoke all on table public.notification_contact_decisions from public, anon, authenticated;

grant select, insert, update, delete on table public.notification_contact_policies to service_role;
grant select, insert, update, delete on table public.notification_contact_decisions to service_role;

create trigger notification_contact_policies_touch_updated_at
before update on public.notification_contact_policies
for each row execute function private.notifications_touch_updated_at();

create or replace function private.seed_notification_contact_policies(
  p_studio_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_contact_policies (
    studio_id,
    communication_class,
    cooldown_seconds,
    max_per_24h,
    max_per_7d,
    collision_window_before_seconds,
    collision_window_after_seconds,
    on_higher_class_collision,
    defer_seconds,
    respect_quiet_hours,
    respect_marketing_preferences,
    enabled
  ) values
    (
      p_studio_id, 'P0',
      0, null, null,
      0, 0,
      'allow', 0,
      false, false, true
    ),
    (
      p_studio_id, 'P1',
      86400, 1, 7,
      7200, 7200,
      'defer', 7200,
      true, false, true
    ),
    (
      p_studio_id, 'P2',
      259200, 1, 2,
      7200, 7200,
      'suppress', 7200,
      true, true, true
    )
  on conflict (studio_id, communication_class) do nothing;
end;
$$;

revoke all on function private.seed_notification_contact_policies(uuid)
from public, anon, authenticated;

create or replace function private.seed_notification_contact_policies_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_notification_contact_policies(new.id);
  return new;
end;
$$;

revoke all on function private.seed_notification_contact_policies_trigger()
from public, anon, authenticated;

drop trigger if exists studios_seed_notification_contact_policies on public.studios;

create trigger studios_seed_notification_contact_policies
after insert on public.studios
for each row execute function private.seed_notification_contact_policies_trigger();

do $$
declare
  v_studio_id uuid;
begin
  for v_studio_id in select id from public.studios loop
    perform private.seed_notification_contact_policies(v_studio_id);
  end loop;
end $$;

create or replace function private.notification_class_rank(
  p_class text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_class
    when 'P0' then 0
    when 'P1' then 1
    when 'P2' then 2
    else 99
  end;
$$;

revoke all on function private.notification_class_rank(text)
from public, anon, authenticated;
