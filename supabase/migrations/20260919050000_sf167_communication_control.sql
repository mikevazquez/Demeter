create type public.automation_communication_priority as enum ('P0','P1','P2','P3');

create type public.automation_communication_decision as enum (
  'send',
  'defer',
  'suppress',
  'substitute',
  'combine'
);

create table public.automation_communication_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  global_send_window text,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint automation_communication_settings_window_chk check (
    global_send_window is null
    or global_send_window ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
  )
);

comment on table public.automation_communication_settings is
  'SF-167 studio-level communication control settings. Studio timezone remains the source of truth in studios.timezone.';

create table public.automation_communication_controls (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  instance_id uuid not null,
  version_number integer not null check (version_number >= 1),
  catalog_code text not null,
  eligibility_evaluation_id uuid not null
    references public.automation_eligibility_evaluations(id) on delete restrict,
  parent_control_id uuid,
  candidate_key text not null check (length(trim(candidate_key)) > 0),
  subject_entity_type text,
  subject_entity_id uuid,
  priority public.automation_communication_priority not null,
  decision public.automation_communication_decision not null,
  reason_code text not null check (length(trim(reason_code)) > 0),
  reason text not null check (length(trim(reason)) > 0),
  group_key text,
  dominant_key text,
  deferred_until timestamptz,
  related_candidate_keys jsonb not null default '[]'::jsonb
    check (jsonb_typeof(related_candidate_keys) = 'array'),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint automation_communication_controls_studio_id_unique unique (studio_id, id),
  constraint automation_communication_controls_eligibility_unique unique (eligibility_evaluation_id),
  constraint automation_communication_controls_instance_tenant_fkey
    foreign key (studio_id, instance_id)
    references public.automation_instances(studio_id, id)
    on delete restrict,
  constraint automation_communication_controls_instance_version_fkey
    foreign key (instance_id, version_number)
    references public.automation_instance_versions(instance_id, version_number)
    on delete restrict,
  constraint automation_communication_controls_parent_tenant_fkey
    foreign key (studio_id, parent_control_id)
    references public.automation_communication_controls(studio_id, id)
    on delete restrict,
  constraint automation_communication_controls_subject_pair_chk check (
    (subject_entity_type is null and subject_entity_id is null)
    or (length(trim(subject_entity_type)) > 0 and subject_entity_id is not null)
  ),
  constraint automation_communication_controls_defer_time_chk check (
    decision = 'defer' or deferred_until is null
  )
);

comment on table public.automation_communication_controls is
  'SF-167 append-only communication-control decisions after eligibility and before execution. Deferred decisions require SF-165 revalidation before release.';

create index automation_communication_controls_studio_evaluated_idx
  on public.automation_communication_controls(studio_id, evaluated_at desc);

create index automation_communication_controls_candidate_idx
  on public.automation_communication_controls(studio_id, candidate_key, evaluated_at desc);

create index automation_communication_controls_group_idx
  on public.automation_communication_controls(studio_id, group_key, evaluated_at desc)
  where group_key is not null;

create index automation_communication_controls_parent_idx
  on public.automation_communication_controls(parent_control_id)
  where parent_control_id is not null;

alter table public.automation_communication_settings enable row level security;
alter table public.automation_communication_controls enable row level security;

create policy automation_communication_settings_read
on public.automation_communication_settings
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

create policy automation_communication_settings_insert
on public.automation_communication_settings
for insert
to authenticated
with check (private.has_capability(studio_id, 'automations.manage'));

create policy automation_communication_settings_update
on public.automation_communication_settings
for update
to authenticated
using (private.has_capability(studio_id, 'automations.manage'))
with check (private.has_capability(studio_id, 'automations.manage'));

create policy automation_communication_controls_read
on public.automation_communication_controls
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

revoke all on table public.automation_communication_settings
  from anon, authenticated, service_role;
revoke all on table public.automation_communication_controls
  from anon, authenticated, service_role;

grant select, insert, update on table public.automation_communication_settings
  to authenticated;
grant select, insert, update on table public.automation_communication_settings
  to service_role;
grant select on table public.automation_communication_controls
  to authenticated, service_role;

create or replace function private.assert_automation_send_window(p_window text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start time;
  v_end time;
begin
  if p_window is null or trim(p_window) = '' then
    return;
  end if;

  if trim(p_window) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'automation_send_window_invalid';
  end if;

  v_start := split_part(trim(p_window), '-', 1)::time;
  v_end := split_part(trim(p_window), '-', 2)::time;

  if v_start = v_end then
    raise exception 'automation_send_window_empty';
  end if;
end;
$$;

revoke all on function private.assert_automation_send_window(text)
from public, anon, authenticated, service_role;

create or replace function private.assert_automation_configuration(
  p_catalog_code text,
  p_configuration jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invalid_key text;
begin
  if private.automation_catalog_mode(p_catalog_code) is null then
    raise exception 'automation_catalog_code_invalid';
  end if;

  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object' then
    raise exception 'automation_configuration_must_be_object';
  end if;

  select k.key
    into v_invalid_key
  from jsonb_object_keys(p_configuration) as k(key)
  where not (
    k.key = any(private.automation_allowed_config_keys(p_catalog_code))
  )
  limit 1;

  if v_invalid_key is not null then
    raise exception 'automation_configuration_key_not_allowed:%', v_invalid_key;
  end if;

  if p_configuration ? 'send_window' then
    if jsonb_typeof(p_configuration->'send_window') <> 'string' then
      raise exception 'automation_send_window_must_be_string';
    end if;
    perform private.assert_automation_send_window(p_configuration->>'send_window');
  end if;
end;
$$;

revoke all on function private.assert_automation_configuration(text,jsonb)
from public, anon, authenticated, service_role;

create or replace function private.automation_communication_window_state(
  p_window text,
  p_timezone text,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_start time;
  v_end time;
  v_local timestamp;
  v_local_time time;
  v_open boolean;
  v_next_local timestamp;
  v_next_open timestamptz;
begin
  if p_at is null then
    raise exception 'automation_communication_window_time_required';
  end if;

  if p_window is null or trim(p_window) = '' then
    return jsonb_build_object('open', true, 'next_open_at', null);
  end if;

  perform private.assert_automation_send_window(p_window);

  v_start := split_part(trim(p_window), '-', 1)::time;
  v_end := split_part(trim(p_window), '-', 2)::time;
  v_local := p_at at time zone p_timezone;
  v_local_time := v_local::time;

  if v_start < v_end then
    v_open := v_local_time >= v_start and v_local_time < v_end;
    if not v_open then
      if v_local_time < v_start then
        v_next_local := v_local::date + v_start;
      else
        v_next_local := (v_local::date + 1) + v_start;
      end if;
    end if;
  else
    v_open := v_local_time >= v_start or v_local_time < v_end;
    if not v_open then
      v_next_local := v_local::date + v_start;
    end if;
  end if;

  if v_open then
    return jsonb_build_object('open', true, 'next_open_at', null);
  end if;

  v_next_open := v_next_local at time zone p_timezone;
  return jsonb_build_object('open', false, 'next_open_at', v_next_open);
end;
$$;

revoke all on function private.automation_communication_window_state(text,text,timestamptz)
from public, anon, authenticated, service_role;

create or replace function public.system_get_automation_communication_window(
  p_instance_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_timezone text;
  v_global_window text;
  v_automation_window text;
  v_cursor timestamptz := p_at;
  v_global_state jsonb;
  v_automation_state jsonb;
  v_next_global timestamptz;
  v_next_automation timestamptz;
  v_next_cursor timestamptz;
  v_iteration integer;
begin
  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  select s.timezone
    into v_timezone
  from public.studios s
  where s.id = v_instance.studio_id;

  if trim(coalesce(v_timezone, '')) = '' then
    raise exception 'studio_timezone_required';
  end if;

  select settings.global_send_window
    into v_global_window
  from public.automation_communication_settings settings
  where settings.studio_id = v_instance.studio_id;

  select nullif(trim(v.configuration->>'send_window'), '')
    into v_automation_window
  from public.automation_instance_versions v
  where v.instance_id = v_instance.id
    and v.version_number = v_instance.current_version_number;

  perform private.assert_automation_send_window(v_global_window);
  perform private.assert_automation_send_window(v_automation_window);

  for v_iteration in 0..31 loop
    v_global_state := private.automation_communication_window_state(
      v_global_window,
      v_timezone,
      v_cursor
    );
    v_automation_state := private.automation_communication_window_state(
      v_automation_window,
      v_timezone,
      v_cursor
    );

    if (v_global_state->>'open')::boolean
       and (v_automation_state->>'open')::boolean then
      return jsonb_build_object(
        'open', v_cursor = p_at,
        'next_open_at', case when v_cursor = p_at then null else v_cursor end,
        'timezone', v_timezone,
        'global_window', v_global_window,
        'automation_window', v_automation_window,
        'reason_code', case when v_cursor = p_at then null else 'outside_send_window' end
      );
    end if;

    v_next_global := nullif(v_global_state->>'next_open_at', '')::timestamptz;
    v_next_automation := nullif(v_automation_state->>'next_open_at', '')::timestamptz;

    if not (v_global_state->>'open')::boolean
       and not (v_automation_state->>'open')::boolean then
      v_next_cursor := greatest(v_next_global, v_next_automation);
    elsif not (v_global_state->>'open')::boolean then
      v_next_cursor := v_next_global;
    else
      v_next_cursor := v_next_automation;
    end if;

    if v_next_cursor is null then
      exit;
    end if;

    if v_next_cursor <= v_cursor then
      v_next_cursor := v_cursor + interval '1 minute';
    end if;

    v_cursor := v_next_cursor;
  end loop;

  return jsonb_build_object(
    'open', false,
    'next_open_at', null,
    'timezone', v_timezone,
    'global_window', v_global_window,
    'automation_window', v_automation_window,
    'reason_code', 'send_windows_do_not_overlap'
  );
end;
$$;

revoke all on function public.system_get_automation_communication_window(uuid,timestamptz)
from public, anon, authenticated;
grant execute on function public.system_get_automation_communication_window(uuid,timestamptz)
to service_role;

create or replace function private.reject_automation_communication_control_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'automation_communication_control_history_immutable';
end;
$$;

revoke all on function private.reject_automation_communication_control_mutation()
from public, anon, authenticated, service_role;

create trigger automation_communication_controls_immutable
before update or delete on public.automation_communication_controls
for each row execute function private.reject_automation_communication_control_mutation();

create or replace function public.system_record_automation_communication_control(
  p_eligibility_evaluation_id uuid,
  p_priority public.automation_communication_priority,
  p_decision public.automation_communication_decision,
  p_reason_code text,
  p_reason text,
  p_group_key text default null,
  p_dominant_key text default null,
  p_deferred_until timestamptz default null,
  p_related_candidate_keys jsonb default '[]'::jsonb,
  p_details jsonb default '{}'::jsonb,
  p_parent_control_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.automation_eligibility_evaluations%rowtype;
  v_parent public.automation_communication_controls%rowtype;
  v_existing public.automation_communication_controls%rowtype;
  v_control_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_priority is null or p_decision is null then
    raise exception 'automation_communication_control_decision_required';
  end if;

  if trim(coalesce(p_reason_code, '')) = ''
     or trim(coalesce(p_reason, '')) = '' then
    raise exception 'automation_communication_control_reason_required';
  end if;

  if p_related_candidate_keys is null
     or jsonb_typeof(p_related_candidate_keys) <> 'array' then
    raise exception 'automation_communication_related_candidates_must_be_array';
  end if;

  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'automation_communication_control_details_must_be_object';
  end if;

  if p_decision <> 'defer' and p_deferred_until is not null then
    raise exception 'automation_communication_deferred_until_invalid';
  end if;

  select *
    into v_evaluation
  from public.automation_eligibility_evaluations
  where id = p_eligibility_evaluation_id;

  if not found then
    raise exception 'automation_communication_eligibility_not_found';
  end if;

  if v_evaluation.decision <> 'eligible'
     or v_evaluation.outcome <> 'proceed' then
    raise exception 'automation_communication_requires_eligible_evaluation';
  end if;

  if p_parent_control_id is not null then
    select *
      into v_parent
    from public.automation_communication_controls
    where id = p_parent_control_id;

    if not found then
      raise exception 'automation_communication_parent_not_found';
    end if;

    if v_parent.studio_id <> v_evaluation.studio_id
       or v_parent.instance_id <> v_evaluation.instance_id
       or v_parent.version_number <> v_evaluation.version_number
       or v_parent.candidate_key <> v_evaluation.candidate_key then
      raise exception 'automation_communication_parent_mismatch';
    end if;

    if v_parent.decision <> 'defer' then
      raise exception 'automation_communication_parent_not_deferred';
    end if;

    if v_evaluation.phase <> 'revalidation' then
      raise exception 'automation_communication_deferred_revalidation_required';
    end if;
  end if;

  select *
    into v_existing
  from public.automation_communication_controls
  where eligibility_evaluation_id = v_evaluation.id;

  if found then
    if v_existing.priority <> p_priority
       or v_existing.decision <> p_decision
       or v_existing.reason_code <> trim(p_reason_code)
       or v_existing.reason <> trim(p_reason)
       or v_existing.group_key is distinct from nullif(trim(coalesce(p_group_key, '')), '')
       or v_existing.dominant_key is distinct from nullif(trim(coalesce(p_dominant_key, '')), '')
       or v_existing.deferred_until is distinct from p_deferred_until
       or v_existing.related_candidate_keys <> p_related_candidate_keys
       or v_existing.details <> p_details
       or v_existing.parent_control_id is distinct from p_parent_control_id then
      raise exception 'automation_communication_control_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'control_id', v_existing.id,
      'decision', v_existing.decision,
      'created', false,
      'requires_revalidation', v_existing.decision = 'defer',
      'deferred_until', v_existing.deferred_until
    );
  end if;

  insert into public.automation_communication_controls (
    studio_id,
    instance_id,
    version_number,
    catalog_code,
    eligibility_evaluation_id,
    parent_control_id,
    candidate_key,
    subject_entity_type,
    subject_entity_id,
    priority,
    decision,
    reason_code,
    reason,
    group_key,
    dominant_key,
    deferred_until,
    related_candidate_keys,
    details,
    evaluated_at,
    created_at
  ) values (
    v_evaluation.studio_id,
    v_evaluation.instance_id,
    v_evaluation.version_number,
    v_evaluation.catalog_code,
    v_evaluation.id,
    p_parent_control_id,
    v_evaluation.candidate_key,
    v_evaluation.subject_entity_type,
    v_evaluation.subject_entity_id,
    p_priority,
    p_decision,
    trim(p_reason_code),
    trim(p_reason),
    nullif(trim(coalesce(p_group_key, '')), ''),
    nullif(trim(coalesce(p_dominant_key, '')), ''),
    p_deferred_until,
    p_related_candidate_keys,
    p_details,
    v_now,
    v_now
  )
  returning id into v_control_id;

  return jsonb_build_object(
    'control_id', v_control_id,
    'decision', p_decision,
    'created', true,
    'requires_revalidation', p_decision = 'defer',
    'deferred_until', p_deferred_until
  );
end;
$$;

revoke all on function public.system_record_automation_communication_control(
  uuid,
  public.automation_communication_priority,
  public.automation_communication_decision,
  text,text,text,text,timestamptz,jsonb,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.system_record_automation_communication_control(
  uuid,
  public.automation_communication_priority,
  public.automation_communication_decision,
  text,text,text,text,timestamptz,jsonb,jsonb,uuid
) to service_role;
