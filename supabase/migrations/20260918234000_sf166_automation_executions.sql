create type public.automation_execution_status as enum (
  'eligible',
  'scheduled',
  'processing',
  'sent',
  'accepted',
  'suppressed',
  'cancelled',
  'error'
);

create type public.automation_execution_attempt_status as enum (
  'processing',
  'sent',
  'accepted',
  'error'
);

create type public.automation_execution_event_type as enum (
  'created',
  'attempt_started',
  'request_sent',
  'provider_accepted',
  'suppressed',
  'cancelled',
  'error'
);

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  instance_id uuid not null,
  version_number integer not null check (version_number >= 1),
  catalog_code text not null,
  origin_eligibility_evaluation_id uuid not null
    references public.automation_eligibility_evaluations(id) on delete restrict,
  latest_eligibility_evaluation_id uuid not null
    references public.automation_eligibility_evaluations(id) on delete restrict,
  candidate_key text not null check (length(trim(candidate_key)) > 0),
  event_id uuid references public.domain_events(event_id) on delete restrict,
  subject_entity_type text,
  subject_entity_id uuid,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  status public.automation_execution_status not null,
  scheduled_for timestamptz,
  data_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_snapshot) = 'object'),
  template_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(template_snapshot) = 'object'),
  variables_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(variables_snapshot) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_error_message text,
  last_error_retryable boolean,
  first_processing_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_executions_studio_id_unique unique (studio_id, id),
  constraint automation_executions_idempotency_unique unique (studio_id, idempotency_key),
  constraint automation_executions_origin_evaluation_unique unique (origin_eligibility_evaluation_id),
  constraint automation_executions_instance_tenant_fkey
    foreign key (studio_id, instance_id)
    references public.automation_instances(studio_id, id)
    on delete restrict,
  constraint automation_executions_instance_version_fkey
    foreign key (instance_id, version_number)
    references public.automation_instance_versions(instance_id, version_number)
    on delete restrict,
  constraint automation_executions_subject_pair_chk check (
    (subject_entity_type is null and subject_entity_id is null)
    or (length(trim(subject_entity_type)) > 0 and subject_entity_id is not null)
  ),
  constraint automation_executions_schedule_chk check (
    status <> 'scheduled' or scheduled_for is not null
  ),
  constraint automation_executions_completed_chk check (
    (status in ('accepted','suppressed','cancelled') and completed_at is not null)
    or (status not in ('accepted','suppressed','cancelled'))
  )
);

comment on table public.automation_executions is
  'SF-166 stable automation execution records. Technical status is separate from business outcome.';

create index automation_executions_studio_created_idx
  on public.automation_executions(studio_id, created_at desc);
create index automation_executions_instance_created_idx
  on public.automation_executions(studio_id, instance_id, created_at desc);
create index automation_executions_status_schedule_idx
  on public.automation_executions(studio_id, status, scheduled_for)
  where status in ('scheduled','error');
create index automation_executions_event_idx
  on public.automation_executions(event_id)
  where event_id is not null;

create table public.automation_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  execution_id uuid not null,
  attempt_number integer not null check (attempt_number >= 1),
  eligibility_evaluation_id uuid not null
    references public.automation_eligibility_evaluations(id) on delete restrict,
  status public.automation_execution_attempt_status not null default 'processing',
  provider_key text,
  provider_reference text,
  request_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_snapshot) = 'object'),
  response_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_snapshot) = 'object'),
  error_code text,
  error_message text,
  retryable boolean,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_execution_attempts_studio_id_unique unique (studio_id, id),
  constraint automation_execution_attempts_execution_number_unique
    unique (execution_id, attempt_number),
  constraint automation_execution_attempts_execution_tenant_fkey
    foreign key (studio_id, execution_id)
    references public.automation_executions(studio_id, id)
    on delete restrict,
  constraint automation_execution_attempts_error_chk check (
    status <> 'error'
    or (
      length(trim(coalesce(error_code, ''))) > 0
      and length(trim(coalesce(error_message, ''))) > 0
      and finished_at is not null
    )
  ),
  constraint automation_execution_attempts_accepted_chk check (
    status <> 'accepted'
    or (accepted_at is not null and finished_at is not null)
  )
);

create index automation_execution_attempts_execution_idx
  on public.automation_execution_attempts(studio_id, execution_id, attempt_number desc);
create index automation_execution_attempts_evaluation_idx
  on public.automation_execution_attempts(eligibility_evaluation_id);

create table public.automation_execution_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  execution_id uuid not null,
  attempt_id uuid,
  event_type public.automation_execution_event_type not null,
  from_status public.automation_execution_status,
  to_status public.automation_execution_status not null,
  code text,
  message text,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint automation_execution_events_execution_tenant_fkey
    foreign key (studio_id, execution_id)
    references public.automation_executions(studio_id, id)
    on delete restrict,
  constraint automation_execution_events_attempt_tenant_fkey
    foreign key (studio_id, attempt_id)
    references public.automation_execution_attempts(studio_id, id)
    on delete restrict
);

comment on table public.automation_execution_events is
  'SF-166 append-only technical/functional timeline. Provider accepted does not mean delivered or read.';

create index automation_execution_events_execution_idx
  on public.automation_execution_events(studio_id, execution_id, occurred_at, created_at);
create index automation_execution_events_attempt_idx
  on public.automation_execution_events(attempt_id)
  where attempt_id is not null;

alter table public.automation_executions enable row level security;
alter table public.automation_execution_attempts enable row level security;
alter table public.automation_execution_events enable row level security;

create policy automation_executions_read
on public.automation_executions
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

create policy automation_execution_attempts_read
on public.automation_execution_attempts
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

create policy automation_execution_events_read
on public.automation_execution_events
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

revoke all on table public.automation_executions
  from anon, authenticated, service_role;
revoke all on table public.automation_execution_attempts
  from anon, authenticated, service_role;
revoke all on table public.automation_execution_events
  from anon, authenticated, service_role;

grant select on table public.automation_executions
  to authenticated, service_role;
grant select on table public.automation_execution_attempts
  to authenticated, service_role;
grant select on table public.automation_execution_events
  to authenticated, service_role;

create or replace function private.reject_automation_execution_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'automation_execution_timeline_immutable';
end;
$$;

revoke all on function private.reject_automation_execution_event_mutation()
from public, anon, authenticated, service_role;

create trigger automation_execution_events_immutable
before update or delete on public.automation_execution_events
for each row execute function private.reject_automation_execution_event_mutation();

create or replace function private.assert_execution_json_object(
  p_value jsonb,
  p_error_code text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '%', p_error_code;
  end if;
end;
$$;

revoke all on function private.assert_execution_json_object(jsonb,text)
from public, anon, authenticated, service_role;

create or replace function private.load_matching_execution_evaluation(
  p_execution public.automation_executions,
  p_evaluation_id uuid
)
returns public.automation_eligibility_evaluations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.automation_eligibility_evaluations%rowtype;
begin
  select *
    into v_evaluation
  from public.automation_eligibility_evaluations
  where id = p_evaluation_id;

  if not found then
    raise exception 'automation_execution_evaluation_not_found';
  end if;

  if v_evaluation.studio_id <> p_execution.studio_id
     or v_evaluation.instance_id <> p_execution.instance_id
     or v_evaluation.version_number <> p_execution.version_number
     or v_evaluation.candidate_key <> p_execution.candidate_key then
    raise exception 'automation_execution_evaluation_mismatch';
  end if;

  return v_evaluation;
end;
$$;

revoke all on function private.load_matching_execution_evaluation(
  public.automation_executions,uuid
) from public, anon, authenticated, service_role;

create or replace function public.system_create_automation_execution(
  p_eligibility_evaluation_id uuid,
  p_idempotency_key text,
  p_data_snapshot jsonb default '{}'::jsonb,
  p_template_snapshot jsonb default '{}'::jsonb,
  p_variables_snapshot jsonb default '{}'::jsonb,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.automation_eligibility_evaluations%rowtype;
  v_existing public.automation_executions%rowtype;
  v_execution_id uuid;
  v_status public.automation_execution_status;
  v_now timestamptz := clock_timestamp();
begin
  if trim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'automation_execution_idempotency_key_required';
  end if;

  perform private.assert_execution_json_object(
    p_data_snapshot,
    'automation_execution_data_snapshot_must_be_object'
  );
  perform private.assert_execution_json_object(
    p_template_snapshot,
    'automation_execution_template_snapshot_must_be_object'
  );
  perform private.assert_execution_json_object(
    p_variables_snapshot,
    'automation_execution_variables_snapshot_must_be_object'
  );

  select *
    into v_evaluation
  from public.automation_eligibility_evaluations
  where id = p_eligibility_evaluation_id;

  if not found then
    raise exception 'automation_execution_evaluation_not_found';
  end if;

  if v_evaluation.decision <> 'eligible'
     or v_evaluation.outcome <> 'proceed' then
    raise exception 'automation_execution_requires_eligible_evaluation';
  end if;

  select *
    into v_existing
  from public.automation_executions
  where studio_id = v_evaluation.studio_id
    and idempotency_key = trim(p_idempotency_key);

  if found then
    if v_existing.origin_eligibility_evaluation_id <> v_evaluation.id
       or v_existing.instance_id <> v_evaluation.instance_id
       or v_existing.version_number <> v_evaluation.version_number
       or v_existing.candidate_key <> v_evaluation.candidate_key then
      raise exception 'automation_execution_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'execution_id', v_existing.id,
      'status', v_existing.status,
      'created', false
    );
  end if;

  select *
    into v_existing
  from public.automation_executions
  where origin_eligibility_evaluation_id = v_evaluation.id;

  if found then
    if v_existing.idempotency_key <> trim(p_idempotency_key) then
      raise exception 'automation_execution_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'execution_id', v_existing.id,
      'status', v_existing.status,
      'created', false
    );
  end if;

  v_status := case
    when p_scheduled_for is null then 'eligible'::public.automation_execution_status
    else 'scheduled'::public.automation_execution_status
  end;

  insert into public.automation_executions (
    studio_id,
    instance_id,
    version_number,
    catalog_code,
    origin_eligibility_evaluation_id,
    latest_eligibility_evaluation_id,
    candidate_key,
    event_id,
    subject_entity_type,
    subject_entity_id,
    idempotency_key,
    status,
    scheduled_for,
    data_snapshot,
    template_snapshot,
    variables_snapshot,
    created_at,
    updated_at
  ) values (
    v_evaluation.studio_id,
    v_evaluation.instance_id,
    v_evaluation.version_number,
    v_evaluation.catalog_code,
    v_evaluation.id,
    v_evaluation.id,
    v_evaluation.candidate_key,
    v_evaluation.event_id,
    v_evaluation.subject_entity_type,
    v_evaluation.subject_entity_id,
    trim(p_idempotency_key),
    v_status,
    p_scheduled_for,
    p_data_snapshot,
    p_template_snapshot,
    p_variables_snapshot,
    v_now,
    v_now
  )
  returning id into v_execution_id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_evaluation.studio_id,
    v_execution_id,
    'created',
    null,
    v_status,
    case when v_status = 'scheduled' then 'execution_scheduled' else 'execution_eligible' end,
    case
      when v_status = 'scheduled' then 'Ejecución creada y programada.'
      else 'Ejecución creada y elegible para procesamiento.'
    end,
    jsonb_build_object(
      'origin_eligibility_evaluation_id', v_evaluation.id,
      'scheduled_for', p_scheduled_for
    ),
    v_now,
    v_now
  );

  return jsonb_build_object(
    'execution_id', v_execution_id,
    'status', v_status,
    'created', true
  );
end;
$$;

revoke all on function public.system_create_automation_execution(
  uuid,text,jsonb,jsonb,jsonb,timestamptz
) from public, anon, authenticated;
grant execute on function public.system_create_automation_execution(
  uuid,text,jsonb,jsonb,jsonb,timestamptz
) to service_role;

create or replace function public.system_start_automation_execution_attempt(
  p_execution_id uuid,
  p_eligibility_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.automation_executions%rowtype;
  v_evaluation public.automation_eligibility_evaluations%rowtype;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_now timestamptz := clock_timestamp();
begin
  select *
    into v_execution
  from public.automation_executions
  where id = p_execution_id
  for update;

  if not found then
    raise exception 'automation_execution_not_found';
  end if;

  if v_execution.status in ('accepted','suppressed','cancelled') then
    raise exception 'automation_execution_terminal';
  end if;

  if v_execution.status in ('processing','sent') then
    raise exception 'automation_execution_attempt_already_active';
  end if;

  if v_execution.status = 'scheduled'
     and v_execution.scheduled_for is not null
     and v_execution.scheduled_for > v_now then
    raise exception 'automation_execution_not_due';
  end if;

  if v_execution.status = 'error'
     and coalesce(v_execution.last_error_retryable, false) = false then
    raise exception 'automation_execution_not_retryable';
  end if;

  v_evaluation := private.load_matching_execution_evaluation(
    v_execution,
    p_eligibility_evaluation_id
  );

  if v_evaluation.decision <> 'eligible'
     or v_evaluation.outcome <> 'proceed' then
    raise exception 'automation_execution_requires_eligible_evaluation';
  end if;

  if v_execution.status in ('scheduled','error')
     and v_evaluation.phase <> 'revalidation' then
    raise exception 'automation_execution_revalidation_required';
  end if;

  v_attempt_number := v_execution.attempt_count + 1;

  insert into public.automation_execution_attempts (
    studio_id,
    execution_id,
    attempt_number,
    eligibility_evaluation_id,
    status,
    started_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    v_attempt_number,
    v_evaluation.id,
    'processing',
    v_now,
    v_now
  )
  returning id into v_attempt_id;

  update public.automation_executions
  set status = 'processing',
      latest_eligibility_evaluation_id = v_evaluation.id,
      attempt_count = v_attempt_number,
      first_processing_at = coalesce(first_processing_at, v_now),
      last_error_code = null,
      last_error_message = null,
      last_error_retryable = null,
      updated_at = v_now
  where id = v_execution.id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    attempt_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    v_attempt_id,
    'attempt_started',
    v_execution.status,
    'processing',
    'attempt_started',
    'Intento de ejecución iniciado.',
    jsonb_build_object(
      'attempt_number', v_attempt_number,
      'eligibility_evaluation_id', v_evaluation.id,
      'eligibility_phase', v_evaluation.phase
    ),
    v_now,
    v_now
  );

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'attempt_number', v_attempt_number
  );
end;
$$;

revoke all on function public.system_start_automation_execution_attempt(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.system_start_automation_execution_attempt(uuid,uuid)
to service_role;

create or replace function public.system_mark_automation_execution_sent(
  p_attempt_id uuid,
  p_provider_key text,
  p_request_snapshot jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.automation_execution_attempts%rowtype;
  v_execution public.automation_executions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if trim(coalesce(p_provider_key, '')) = '' then
    raise exception 'automation_execution_provider_key_required';
  end if;

  perform private.assert_execution_json_object(
    p_request_snapshot,
    'automation_execution_request_snapshot_must_be_object'
  );

  select *
    into v_attempt
  from public.automation_execution_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'automation_execution_attempt_not_found';
  end if;

  select *
    into v_execution
  from public.automation_executions
  where id = v_attempt.execution_id
  for update;

  if v_attempt.status = 'sent' and v_execution.status = 'sent' then
    return;
  end if;

  if v_attempt.status <> 'processing'
     or v_execution.status <> 'processing' then
    raise exception 'automation_execution_transition_invalid';
  end if;

  update public.automation_execution_attempts
  set status = 'sent',
      provider_key = trim(p_provider_key),
      request_snapshot = p_request_snapshot,
      sent_at = v_now
  where id = v_attempt.id;

  update public.automation_executions
  set status = 'sent',
      sent_at = coalesce(sent_at, v_now),
      updated_at = v_now
  where id = v_execution.id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    attempt_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    v_attempt.id,
    'request_sent',
    'processing',
    'sent',
    'request_sent',
    'La operación fue enviada al ejecutor/proveedor.',
    jsonb_build_object(
      'attempt_number', v_attempt.attempt_number,
      'provider_key', trim(p_provider_key)
    ),
    v_now,
    v_now
  );
end;
$$;

revoke all on function public.system_mark_automation_execution_sent(uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function public.system_mark_automation_execution_sent(uuid,text,jsonb)
to service_role;

create or replace function public.system_mark_automation_execution_accepted(
  p_attempt_id uuid,
  p_provider_reference text default null,
  p_response_snapshot jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.automation_execution_attempts%rowtype;
  v_execution public.automation_executions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform private.assert_execution_json_object(
    p_response_snapshot,
    'automation_execution_response_snapshot_must_be_object'
  );

  select *
    into v_attempt
  from public.automation_execution_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'automation_execution_attempt_not_found';
  end if;

  select *
    into v_execution
  from public.automation_executions
  where id = v_attempt.execution_id
  for update;

  if v_attempt.status = 'accepted' and v_execution.status = 'accepted' then
    return;
  end if;

  if v_attempt.status <> 'sent'
     or v_execution.status <> 'sent' then
    raise exception 'automation_execution_transition_invalid';
  end if;

  update public.automation_execution_attempts
  set status = 'accepted',
      provider_reference = nullif(trim(coalesce(p_provider_reference, '')), ''),
      response_snapshot = p_response_snapshot,
      accepted_at = v_now,
      finished_at = v_now
  where id = v_attempt.id;

  update public.automation_executions
  set status = 'accepted',
      accepted_at = v_now,
      completed_at = v_now,
      updated_at = v_now
  where id = v_execution.id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    attempt_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    v_attempt.id,
    'provider_accepted',
    'sent',
    'accepted',
    'provider_accepted',
    'El ejecutor/proveedor aceptó la operación; no implica entrega ni lectura.',
    jsonb_build_object(
      'attempt_number', v_attempt.attempt_number,
      'provider_key', v_attempt.provider_key,
      'provider_reference', nullif(trim(coalesce(p_provider_reference, '')), '')
    ),
    v_now,
    v_now
  );

  perform public.system_mark_automation_instance_executed(
    v_execution.instance_id,
    v_execution.version_number,
    v_now
  );
end;
$$;

revoke all on function public.system_mark_automation_execution_accepted(uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function public.system_mark_automation_execution_accepted(uuid,text,jsonb)
to service_role;

create or replace function public.system_mark_automation_execution_error(
  p_attempt_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.automation_execution_attempts%rowtype;
  v_execution public.automation_executions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if trim(coalesce(p_error_code, '')) = ''
     or trim(coalesce(p_error_message, '')) = '' then
    raise exception 'automation_execution_error_details_required';
  end if;

  if p_retryable is null then
    raise exception 'automation_execution_retryable_required';
  end if;

  select *
    into v_attempt
  from public.automation_execution_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'automation_execution_attempt_not_found';
  end if;

  select *
    into v_execution
  from public.automation_executions
  where id = v_attempt.execution_id
  for update;

  if v_attempt.status = 'error' and v_execution.status = 'error' then
    return;
  end if;

  if v_attempt.status not in ('processing','sent')
     or v_execution.status not in ('processing','sent') then
    raise exception 'automation_execution_transition_invalid';
  end if;

  update public.automation_execution_attempts
  set status = 'error',
      error_code = trim(p_error_code),
      error_message = trim(p_error_message),
      retryable = p_retryable,
      finished_at = v_now
  where id = v_attempt.id;

  update public.automation_executions
  set status = 'error',
      last_error_code = trim(p_error_code),
      last_error_message = trim(p_error_message),
      last_error_retryable = p_retryable,
      updated_at = v_now
  where id = v_execution.id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    attempt_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    v_attempt.id,
    'error',
    v_execution.status,
    'error',
    trim(p_error_code),
    trim(p_error_message),
    jsonb_build_object(
      'attempt_number', v_attempt.attempt_number,
      'retryable', p_retryable
    ),
    v_now,
    v_now
  );
end;
$$;

revoke all on function public.system_mark_automation_execution_error(uuid,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.system_mark_automation_execution_error(uuid,text,text,boolean)
to service_role;

create or replace function public.system_suppress_automation_execution(
  p_execution_id uuid,
  p_reason_code text,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.automation_executions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if trim(coalesce(p_reason_code, '')) = ''
     or trim(coalesce(p_reason, '')) = '' then
    raise exception 'automation_execution_suppression_reason_required';
  end if;

  perform private.assert_execution_json_object(
    p_details,
    'automation_execution_details_must_be_object'
  );

  select *
    into v_execution
  from public.automation_executions
  where id = p_execution_id
  for update;

  if not found then
    raise exception 'automation_execution_not_found';
  end if;

  if v_execution.status = 'suppressed' then
    return;
  end if;

  if v_execution.status not in ('eligible','scheduled') then
    raise exception 'automation_execution_transition_invalid';
  end if;

  update public.automation_executions
  set status = 'suppressed',
      completed_at = v_now,
      updated_at = v_now
  where id = v_execution.id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    'suppressed',
    v_execution.status,
    'suppressed',
    trim(p_reason_code),
    trim(p_reason),
    p_details,
    v_now,
    v_now
  );
end;
$$;

revoke all on function public.system_suppress_automation_execution(uuid,text,text,jsonb)
from public, anon, authenticated;
grant execute on function public.system_suppress_automation_execution(uuid,text,text,jsonb)
to service_role;

create or replace function public.system_cancel_automation_execution(
  p_execution_id uuid,
  p_revalidation_evaluation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.automation_executions%rowtype;
  v_evaluation public.automation_eligibility_evaluations%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select *
    into v_execution
  from public.automation_executions
  where id = p_execution_id
  for update;

  if not found then
    raise exception 'automation_execution_not_found';
  end if;

  if v_execution.status = 'cancelled' then
    return;
  end if;

  if v_execution.status not in ('eligible','scheduled','error') then
    raise exception 'automation_execution_transition_invalid';
  end if;

  v_evaluation := private.load_matching_execution_evaluation(
    v_execution,
    p_revalidation_evaluation_id
  );

  if v_evaluation.phase <> 'revalidation'
     or v_evaluation.decision <> 'ineligible'
     or v_evaluation.outcome <> 'cancel' then
    raise exception 'automation_execution_cancel_requires_ineligible_revalidation';
  end if;

  update public.automation_executions
  set status = 'cancelled',
      latest_eligibility_evaluation_id = v_evaluation.id,
      completed_at = v_now,
      updated_at = v_now
  where id = v_execution.id;

  insert into public.automation_execution_events (
    studio_id,
    execution_id,
    event_type,
    from_status,
    to_status,
    code,
    message,
    details,
    occurred_at,
    created_at
  ) values (
    v_execution.studio_id,
    v_execution.id,
    'cancelled',
    v_execution.status,
    'cancelled',
    'eligibility_revalidation_cancelled',
    'La ejecución se canceló porque dejó de ser elegible.',
    jsonb_build_object(
      'eligibility_evaluation_id', v_evaluation.id,
      'exclusion_reasons', v_evaluation.exclusion_reasons
    ),
    v_now,
    v_now
  );
end;
$$;

revoke all on function public.system_cancel_automation_execution(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.system_cancel_automation_execution(uuid,uuid)
to service_role;
