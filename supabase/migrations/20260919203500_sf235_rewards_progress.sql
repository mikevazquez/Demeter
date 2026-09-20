create type public.reward_progress_evaluation_kind as enum (
  'event',
  'recalculation',
  'cycle_close'
);

create type public.reward_progress_evaluation_outcome as enum (
  'counted',
  'ignored',
  'recalculated'
);

create table public.reward_rule_event_bindings (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  rule_id uuid not null,
  version_number integer not null check (version_number >= 1),
  event_type text not null check (length(trim(event_type)) > 0),
  metric_key text not null check (length(trim(metric_key)) > 0),
  created_at timestamptz not null default now(),
  constraint reward_rule_event_bindings_rule_tenant_fkey
    foreign key (studio_id, rule_id)
    references public.reward_rules(studio_id, id)
    on delete cascade,
  constraint reward_rule_event_bindings_rule_version_fkey
    foreign key (rule_id, version_number)
    references public.reward_rule_versions(rule_id, version_number)
    on delete cascade,
  constraint reward_rule_event_bindings_unique
    unique (rule_id, version_number, event_type, metric_key)
);

comment on table public.reward_rule_event_bindings is
  'SF-235 indexed event subscriptions. Domain events are matched by event_type instead of scanning every reward rule.';

create index reward_rule_event_bindings_event_idx
  on public.reward_rule_event_bindings(studio_id, event_type, version_number);

create table public.reward_progress_evaluations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  participation_id uuid not null,
  cycle_id uuid not null,
  rule_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  event_id uuid,
  evaluation_kind public.reward_progress_evaluation_kind not null,
  outcome public.reward_progress_evaluation_outcome not null,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  candidate_occurred_at timestamptz not null,
  condition_results jsonb not null default '[]'::jsonb
    check (jsonb_typeof(condition_results) = 'array'),
  progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object'),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  fulfilled boolean not null default false,
  reason_code text,
  supersedes_evaluation_id uuid,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_progress_evaluations_studio_id_unique unique (studio_id, id),
  constraint reward_progress_evaluations_idempotency_unique unique (studio_id, idempotency_key),
  constraint reward_progress_evaluations_participation_fkey
    foreign key (studio_id, participation_id, rule_id, student_id)
    references public.reward_participations(studio_id, id, rule_id, student_id)
    on delete restrict,
  constraint reward_progress_evaluations_cycle_fkey
    foreign key (studio_id, cycle_id)
    references public.reward_cycles(studio_id, id)
    on delete restrict,
  constraint reward_progress_evaluations_rule_version_fkey
    foreign key (rule_id, version_number)
    references public.reward_rule_versions(rule_id, version_number)
    on delete restrict,
  constraint reward_progress_evaluations_event_fkey
    foreign key (studio_id, event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint reward_progress_evaluations_supersedes_fkey
    foreign key (studio_id, supersedes_evaluation_id)
    references public.reward_progress_evaluations(studio_id, id)
    on delete restrict,
  constraint reward_progress_evaluations_ignored_reason_chk check (
    outcome <> 'ignored' or length(trim(coalesce(reason_code, ''))) > 0
  )
);

comment on table public.reward_progress_evaluations is
  'SF-235 append-only progress decisions. Progress is evidence derived from source events, never the source of truth itself.';

create index reward_progress_evaluations_cycle_idx
  on public.reward_progress_evaluations(studio_id, cycle_id, evaluated_at desc, id desc);
create index reward_progress_evaluations_student_idx
  on public.reward_progress_evaluations(studio_id, student_id, evaluated_at desc);
create index reward_progress_evaluations_event_idx
  on public.reward_progress_evaluations(event_id)
  where event_id is not null;
create index reward_progress_evaluations_supersedes_idx
  on public.reward_progress_evaluations(supersedes_evaluation_id)
  where supersedes_evaluation_id is not null;

create table public.reward_cycle_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  cycle_id uuid not null,
  operation text not null check (
    operation in (
      'created',
      'frozen',
      'resumed',
      'fulfilled',
      'reopened',
      'closed_incomplete',
      'cancelled'
    )
  ),
  from_status public.reward_cycle_status,
  to_status public.reward_cycle_status not null,
  reason text,
  source_evaluation_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint reward_cycle_events_cycle_fkey
    foreign key (studio_id, cycle_id)
    references public.reward_cycles(studio_id, id)
    on delete restrict,
  constraint reward_cycle_events_evaluation_fkey
    foreign key (studio_id, source_evaluation_id)
    references public.reward_progress_evaluations(studio_id, id)
    on delete restrict
);

create index reward_cycle_events_cycle_idx
  on public.reward_cycle_events(studio_id, cycle_id, occurred_at, id);

alter table public.reward_rule_event_bindings enable row level security;
alter table public.reward_progress_evaluations enable row level security;
alter table public.reward_cycle_events enable row level security;

create policy reward_rule_event_bindings_read
on public.reward_rule_event_bindings
for select
to authenticated
using (private.has_capability(studio_id, 'rewards.read'));

create policy reward_progress_evaluations_read
on public.reward_progress_evaluations
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or private.is_reward_student_self(studio_id, student_id)
);

create policy reward_cycle_events_read
on public.reward_cycle_events
for select
to authenticated
using (
  private.has_capability(studio_id, 'rewards.read')
  or exists (
    select 1
    from public.reward_cycles c
    where c.id = reward_cycle_events.cycle_id
      and c.studio_id = reward_cycle_events.studio_id
      and private.is_reward_student_self(c.studio_id, c.student_id)
  )
);

revoke all on table public.reward_rule_event_bindings from anon, authenticated, service_role;
revoke all on table public.reward_progress_evaluations from anon, authenticated, service_role;
revoke all on table public.reward_cycle_events from anon, authenticated, service_role;

grant select on table public.reward_rule_event_bindings to authenticated, service_role;
grant select on table public.reward_progress_evaluations to authenticated, service_role;
grant select on table public.reward_cycle_events to authenticated, service_role;

create trigger reward_progress_evaluations_immutable
before update or delete on public.reward_progress_evaluations
for each row execute function private.reject_reward_history_mutation();

create trigger reward_cycle_events_immutable
before update or delete on public.reward_cycle_events
for each row execute function private.reject_reward_history_mutation();

create or replace function public.system_register_reward_rule_event_binding(
  p_rule_id uuid,
  p_version_number integer,
  p_event_type text,
  p_metric_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_binding_id uuid;
begin
  if p_rule_id is null or p_version_number is null or p_version_number < 1 then
    raise exception 'reward_binding_rule_version_required';
  end if;

  if trim(coalesce(p_event_type, '')) = '' then
    raise exception 'reward_binding_event_type_required';
  end if;

  if trim(coalesce(p_metric_key, '')) = '' then
    raise exception 'reward_binding_metric_key_required';
  end if;

  select v.studio_id
    into v_studio_id
  from public.reward_rule_versions v
  where v.rule_id = p_rule_id
    and v.version_number = p_version_number;

  if v_studio_id is null then
    raise exception 'reward_rule_version_not_found';
  end if;

  insert into public.reward_rule_event_bindings (
    studio_id,
    rule_id,
    version_number,
    event_type,
    metric_key
  ) values (
    v_studio_id,
    p_rule_id,
    p_version_number,
    trim(p_event_type),
    trim(p_metric_key)
  )
  on conflict (rule_id, version_number, event_type, metric_key)
  do update set event_type = excluded.event_type
  returning id into v_binding_id;

  return v_binding_id;
end;
$$;

revoke all on function public.system_register_reward_rule_event_binding(uuid,integer,text,text)
from public, anon, authenticated;
grant execute on function public.system_register_reward_rule_event_binding(uuid,integer,text,text)
to service_role;

create or replace function public.reward_rules_for_domain_event(
  p_event_id uuid
)
returns table (
  rule_id uuid,
  version_number integer,
  family public.reward_rule_family,
  event_type text,
  metric_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events%rowtype;
begin
  select *
    into v_event
  from public.domain_events
  where event_id = p_event_id;

  if not found then
    raise exception 'domain_event_not_found';
  end if;

  return query
  select
    b.rule_id,
    b.version_number,
    v.family,
    b.event_type,
    b.metric_key
  from public.reward_rule_event_bindings b
  join public.reward_rules r
    on r.studio_id = b.studio_id
   and r.id = b.rule_id
  join public.reward_rule_versions v
    on v.rule_id = b.rule_id
   and v.version_number = b.version_number
  where b.studio_id = v_event.studio_id
    and b.event_type = v_event.event_type
    and r.status = 'active'
    and r.current_version_number = b.version_number
    and (r.scheduled_start_at is null or v_event.occurred_at >= r.scheduled_start_at)
    and (r.scheduled_end_at is null or v_event.occurred_at <= r.scheduled_end_at)
    and (
      coalesce((v.evaluation_definition->>'allow_historical')::boolean, false)
      or r.first_activated_at is null
      or v_event.occurred_at >= r.first_activated_at
    )
  order by b.rule_id, b.metric_key;
end;
$$;

revoke all on function public.reward_rules_for_domain_event(uuid)
from public, anon, authenticated;
grant execute on function public.reward_rules_for_domain_event(uuid)
to service_role;

create or replace function private.assert_reward_progress_json(
  p_condition_results jsonb,
  p_progress jsonb,
  p_evidence jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_condition_results is null or jsonb_typeof(p_condition_results) <> 'array' then
    raise exception 'reward_condition_results_must_be_array';
  end if;

  if p_progress is null or jsonb_typeof(p_progress) <> 'object' then
    raise exception 'reward_progress_must_be_object';
  end if;

  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'reward_evidence_must_be_object';
  end if;
end;
$$;

revoke all on function private.assert_reward_progress_json(jsonb,jsonb,jsonb)
from public, anon, authenticated, service_role;

create or replace function public.system_record_reward_progress_evaluation(
  p_rule_id uuid,
  p_version_number integer,
  p_student_id uuid,
  p_cycle_key text,
  p_idempotency_key text,
  p_evaluation_kind public.reward_progress_evaluation_kind,
  p_outcome public.reward_progress_evaluation_outcome,
  p_candidate_occurred_at timestamptz,
  p_condition_results jsonb,
  p_progress jsonb,
  p_evidence jsonb default '{}'::jsonb,
  p_event_id uuid default null,
  p_fulfilled boolean default false,
  p_reason_code text default null,
  p_window_start_at timestamptz default null,
  p_window_end_at timestamptz default null,
  p_supersedes_evaluation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_student_studio_id uuid;
  v_event public.domain_events%rowtype;
  v_participation public.reward_participations%rowtype;
  v_cycle public.reward_cycles%rowtype;
  v_evaluation_id uuid;
  v_existing public.reward_progress_evaluations%rowtype;
  v_allow_historical boolean;
  v_prior_cycle_status public.reward_cycle_status;
begin
  if p_rule_id is null or p_version_number is null or p_version_number < 1 then
    raise exception 'reward_progress_rule_version_required';
  end if;

  if p_student_id is null then
    raise exception 'reward_progress_student_required';
  end if;

  if trim(coalesce(p_cycle_key, '')) = '' then
    raise exception 'reward_progress_cycle_key_required';
  end if;

  if trim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'reward_progress_idempotency_key_required';
  end if;

  if p_candidate_occurred_at is null then
    raise exception 'reward_progress_candidate_time_required';
  end if;

  if p_outcome = 'ignored' and trim(coalesce(p_reason_code, '')) = '' then
    raise exception 'reward_progress_ignored_reason_required';
  end if;

  if p_window_start_at is not null
     and p_window_end_at is not null
     and p_window_end_at < p_window_start_at then
    raise exception 'reward_progress_window_invalid';
  end if;

  perform private.assert_reward_progress_json(
    p_condition_results,
    p_progress,
    p_evidence
  );

  select *
    into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then
    raise exception 'reward_rule_not_found';
  end if;

  if v_rule.status <> 'active' then
    raise exception 'reward_rule_not_active';
  end if;

  select *
    into v_version
  from public.reward_rule_versions
  where rule_id = p_rule_id
    and version_number = p_version_number;

  if not found then
    raise exception 'reward_rule_version_not_found';
  end if;

  if v_version.studio_id <> v_rule.studio_id then
    raise exception 'reward_rule_version_studio_mismatch';
  end if;

  select s.studio_id
    into v_student_studio_id
  from public.students s
  where s.id = p_student_id;

  if v_student_studio_id is null then
    raise exception 'reward_student_not_found';
  end if;

  if v_student_studio_id <> v_rule.studio_id then
    raise exception 'reward_student_studio_mismatch';
  end if;

  if p_event_id is not null then
    select *
      into v_event
    from public.domain_events
    where event_id = p_event_id;

    if not found then
      raise exception 'reward_progress_event_not_found';
    end if;

    if v_event.studio_id <> v_rule.studio_id then
      raise exception 'reward_progress_event_studio_mismatch';
    end if;
  end if;

  v_allow_historical := coalesce(
    (v_version.evaluation_definition->>'allow_historical')::boolean,
    false
  );

  if not v_allow_historical
     and v_rule.first_activated_at is not null
     and p_candidate_occurred_at < v_rule.first_activated_at then
    raise exception 'reward_progress_candidate_before_eligibility';
  end if;

  select *
    into v_existing
  from public.reward_progress_evaluations
  where studio_id = v_rule.studio_id
    and idempotency_key = trim(p_idempotency_key);

  if found then
    return jsonb_build_object(
      'evaluation_id', v_existing.id,
      'participation_id', v_existing.participation_id,
      'cycle_id', v_existing.cycle_id,
      'fulfilled', v_existing.fulfilled,
      'created', false
    );
  end if;

  select *
    into v_participation
  from public.reward_participations
  where rule_id = p_rule_id
    and student_id = p_student_id
  for update;

  if not found then
    insert into public.reward_participations (
      studio_id,
      rule_id,
      student_id,
      joined_version_number,
      status,
      joined_at
    ) values (
      v_rule.studio_id,
      p_rule_id,
      p_student_id,
      p_version_number,
      'eligible',
      p_candidate_occurred_at
    )
    returning * into v_participation;
  end if;

  select *
    into v_cycle
  from public.reward_cycles
  where participation_id = v_participation.id
    and cycle_key = trim(p_cycle_key)
  for update;

  if not found then
    insert into public.reward_cycles (
      studio_id,
      participation_id,
      rule_id,
      student_id,
      version_number,
      cycle_key,
      status,
      window_start_at,
      window_end_at
    ) values (
      v_rule.studio_id,
      v_participation.id,
      p_rule_id,
      p_student_id,
      p_version_number,
      trim(p_cycle_key),
      'open',
      p_window_start_at,
      p_window_end_at
    )
    returning * into v_cycle;

    insert into public.reward_cycle_events (
      studio_id,
      cycle_id,
      operation,
      from_status,
      to_status,
      reason
    ) values (
      v_rule.studio_id,
      v_cycle.id,
      'created',
      null,
      'open',
      'cycle_created_by_progress_engine'
    );
  elsif v_cycle.version_number <> p_version_number then
    raise exception 'reward_progress_cycle_version_mismatch';
  end if;

  if v_cycle.status in ('frozen', 'closed_incomplete', 'cancelled') then
    raise exception 'reward_progress_cycle_not_evaluable:%', v_cycle.status;
  end if;

  if p_supersedes_evaluation_id is not null
     and not exists (
       select 1
       from public.reward_progress_evaluations e
       where e.id = p_supersedes_evaluation_id
         and e.studio_id = v_rule.studio_id
         and e.cycle_id = v_cycle.id
     ) then
    raise exception 'reward_progress_superseded_evaluation_invalid';
  end if;

  insert into public.reward_progress_evaluations (
    studio_id,
    participation_id,
    cycle_id,
    rule_id,
    student_id,
    version_number,
    event_id,
    evaluation_kind,
    outcome,
    idempotency_key,
    candidate_occurred_at,
    condition_results,
    progress,
    evidence,
    fulfilled,
    reason_code,
    supersedes_evaluation_id
  ) values (
    v_rule.studio_id,
    v_participation.id,
    v_cycle.id,
    p_rule_id,
    p_student_id,
    p_version_number,
    p_event_id,
    p_evaluation_kind,
    p_outcome,
    trim(p_idempotency_key),
    p_candidate_occurred_at,
    p_condition_results,
    p_progress,
    p_evidence,
    p_fulfilled,
    nullif(trim(coalesce(p_reason_code, '')), ''),
    p_supersedes_evaluation_id
  )
  returning id into v_evaluation_id;

  insert into public.reward_progress_snapshots (
    studio_id,
    cycle_id,
    progress,
    evidence_summary,
    source_through,
    calculated_at
  ) values (
    v_rule.studio_id,
    v_cycle.id,
    p_progress,
    jsonb_build_object(
      'evaluation_id', v_evaluation_id,
      'condition_results', p_condition_results,
      'evidence', p_evidence,
      'outcome', p_outcome,
      'reason_code', nullif(trim(coalesce(p_reason_code, '')), '')
    ),
    p_candidate_occurred_at,
    now()
  );

  v_prior_cycle_status := v_cycle.status;

  if p_outcome = 'recalculated' and not p_fulfilled and v_cycle.status = 'fulfilled' then
    update public.reward_cycles
    set status = 'open',
        fulfilled_at = null,
        updated_at = now()
    where id = v_cycle.id;

    insert into public.reward_cycle_events (
      studio_id,
      cycle_id,
      operation,
      from_status,
      to_status,
      reason,
      source_evaluation_id
    ) values (
      v_rule.studio_id,
      v_cycle.id,
      'reopened',
      'fulfilled',
      'open',
      coalesce(nullif(trim(coalesce(p_reason_code, '')), ''), 'progress_recalculated'),
      v_evaluation_id
    );
  elsif p_fulfilled and v_cycle.status <> 'fulfilled' then
    update public.reward_cycles
    set status = 'fulfilled',
        fulfilled_at = now(),
        updated_at = now()
    where id = v_cycle.id;

    insert into public.reward_cycle_events (
      studio_id,
      cycle_id,
      operation,
      from_status,
      to_status,
      reason,
      source_evaluation_id
    ) values (
      v_rule.studio_id,
      v_cycle.id,
      'fulfilled',
      v_prior_cycle_status,
      'fulfilled',
      'conditions_fulfilled',
      v_evaluation_id
    );
  end if;

  if p_outcome <> 'ignored' then
    update public.reward_participations
    set status = case when p_fulfilled then 'fulfilled' else 'in_progress' end,
        fulfilled_at = case when p_fulfilled then now() else null end,
        updated_at = now()
    where id = v_participation.id;
  end if;

  return jsonb_build_object(
    'evaluation_id', v_evaluation_id,
    'participation_id', v_participation.id,
    'cycle_id', v_cycle.id,
    'fulfilled', p_fulfilled,
    'created', true
  );
end;
$$;

revoke all on function public.system_record_reward_progress_evaluation(
  uuid,integer,uuid,text,text,
  public.reward_progress_evaluation_kind,
  public.reward_progress_evaluation_outcome,
  timestamptz,jsonb,jsonb,jsonb,uuid,boolean,text,timestamptz,timestamptz,uuid
) from public, anon, authenticated;
grant execute on function public.system_record_reward_progress_evaluation(
  uuid,integer,uuid,text,text,
  public.reward_progress_evaluation_kind,
  public.reward_progress_evaluation_outcome,
  timestamptz,jsonb,jsonb,jsonb,uuid,boolean,text,timestamptz,timestamptz,uuid
) to service_role;

create or replace function public.system_transition_reward_cycle(
  p_cycle_id uuid,
  p_action text,
  p_reason text default null
)
returns public.reward_cycle_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.reward_cycles%rowtype;
  v_to_status public.reward_cycle_status;
  v_operation text;
begin
  select *
    into v_cycle
  from public.reward_cycles
  where id = p_cycle_id
  for update;

  if not found then
    raise exception 'reward_cycle_not_found';
  end if;

  case trim(coalesce(p_action, ''))
    when 'freeze' then
      if v_cycle.status <> 'open' then raise exception 'reward_cycle_transition_invalid'; end if;
      v_to_status := 'frozen';
      v_operation := 'frozen';
      update public.reward_cycles
      set status = v_to_status, frozen_at = now(), updated_at = now()
      where id = v_cycle.id;
    when 'resume' then
      if v_cycle.status <> 'frozen' then raise exception 'reward_cycle_transition_invalid'; end if;
      v_to_status := 'open';
      v_operation := 'resumed';
      update public.reward_cycles
      set status = v_to_status, frozen_at = null, updated_at = now()
      where id = v_cycle.id;
    when 'close_incomplete' then
      if v_cycle.status not in ('open', 'frozen') then raise exception 'reward_cycle_transition_invalid'; end if;
      v_to_status := 'closed_incomplete';
      v_operation := 'closed_incomplete';
      update public.reward_cycles
      set status = v_to_status, closed_at = now(), updated_at = now()
      where id = v_cycle.id;
    when 'cancel' then
      if v_cycle.status in ('closed_incomplete', 'cancelled') then raise exception 'reward_cycle_transition_invalid'; end if;
      v_to_status := 'cancelled';
      v_operation := 'cancelled';
      update public.reward_cycles
      set status = v_to_status, closed_at = now(), updated_at = now()
      where id = v_cycle.id;
    else
      raise exception 'reward_cycle_action_invalid';
  end case;

  insert into public.reward_cycle_events (
    studio_id,
    cycle_id,
    operation,
    from_status,
    to_status,
    reason
  ) values (
    v_cycle.studio_id,
    v_cycle.id,
    v_operation,
    v_cycle.status,
    v_to_status,
    nullif(trim(coalesce(p_reason, '')), '')
  );

  return v_to_status;
end;
$$;

revoke all on function public.system_transition_reward_cycle(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.system_transition_reward_cycle(uuid,text,text)
to service_role;
