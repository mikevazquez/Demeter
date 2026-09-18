create type public.automation_eligibility_phase as enum (
  'initial',
  'revalidation'
);

create type public.automation_eligibility_decision as enum (
  'eligible',
  'ineligible'
);

create type public.automation_eligibility_outcome as enum (
  'proceed',
  'skip',
  'cancel'
);

create table public.automation_eligibility_evaluations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  instance_id uuid not null,
  version_number integer not null check (version_number >= 1),
  catalog_code text not null,
  candidate_key text not null check (length(trim(candidate_key)) > 0),
  candidate_occurred_at timestamptz not null,
  event_id uuid,
  subject_entity_type text,
  subject_entity_id uuid,
  phase public.automation_eligibility_phase not null,
  decision public.automation_eligibility_decision not null,
  outcome public.automation_eligibility_outcome not null,
  conditions jsonb not null check (jsonb_typeof(conditions) = 'array'),
  exclusion_reasons jsonb not null check (jsonb_typeof(exclusion_reasons) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint automation_eligibility_instance_tenant_fkey
    foreign key (studio_id, instance_id)
    references public.automation_instances(studio_id, id)
    on delete restrict,
  constraint automation_eligibility_instance_version_fkey
    foreign key (instance_id, version_number)
    references public.automation_instance_versions(instance_id, version_number)
    on delete restrict,
  constraint automation_eligibility_event_tenant_fkey
    foreign key (studio_id, event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict,
  constraint automation_eligibility_subject_pair_chk check (
    (subject_entity_type is null and subject_entity_id is null)
    or (length(trim(subject_entity_type)) > 0 and subject_entity_id is not null)
  ),
  constraint automation_eligibility_outcome_decision_chk check (
    (decision = 'eligible' and outcome = 'proceed')
    or (decision = 'ineligible' and outcome in ('skip', 'cancel'))
  ),
  constraint automation_eligibility_phase_outcome_chk check (
    outcome <> 'cancel' or phase = 'revalidation'
  )
);

comment on table public.automation_eligibility_evaluations is
  'SF-165 append-only eligibility decisions. This is not an execution history and ineligible is not an error.';

create index automation_eligibility_studio_evaluated_idx
  on public.automation_eligibility_evaluations(studio_id, evaluated_at desc);

create index automation_eligibility_instance_evaluated_idx
  on public.automation_eligibility_evaluations(studio_id, instance_id, evaluated_at desc);

create index automation_eligibility_candidate_idx
  on public.automation_eligibility_evaluations(studio_id, candidate_key, evaluated_at desc);

create index automation_eligibility_event_idx
  on public.automation_eligibility_evaluations(event_id)
  where event_id is not null;

alter table public.automation_eligibility_evaluations enable row level security;

create policy automation_eligibility_evaluations_read
on public.automation_eligibility_evaluations
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

revoke all on table public.automation_eligibility_evaluations from anon, authenticated, service_role;
grant select on table public.automation_eligibility_evaluations to authenticated, service_role;

create or replace function private.reject_automation_eligibility_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'automation_eligibility_history_immutable';
end;
$$;

revoke all on function private.reject_automation_eligibility_mutation()
from public, anon, authenticated, service_role;

create trigger automation_eligibility_evaluations_immutable
before update or delete on public.automation_eligibility_evaluations
for each row execute function private.reject_automation_eligibility_mutation();

create or replace function private.assert_automation_eligibility_conditions(
  p_conditions jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_condition jsonb;
begin
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    raise exception 'automation_eligibility_conditions_must_be_array';
  end if;

  for v_condition in
    select value from jsonb_array_elements(p_conditions)
  loop
    if jsonb_typeof(v_condition) <> 'object' then
      raise exception 'automation_eligibility_condition_must_be_object';
    end if;

    if trim(coalesce(v_condition->>'key', '')) = '' then
      raise exception 'automation_eligibility_condition_key_required';
    end if;

    if coalesce(v_condition->>'kind', '') not in ('protected', 'optional') then
      raise exception 'automation_eligibility_condition_kind_invalid';
    end if;

    if jsonb_typeof(v_condition->'applies') <> 'boolean'
       or jsonb_typeof(v_condition->'passed') <> 'boolean' then
      raise exception 'automation_eligibility_condition_boolean_required';
    end if;

    if v_condition->>'kind' = 'protected'
       and coalesce((v_condition->>'applies')::boolean, false) = false then
      raise exception 'automation_eligibility_protected_condition_must_apply';
    end if;

    if trim(coalesce(v_condition->>'reason_code', '')) = ''
       or trim(coalesce(v_condition->>'reason', '')) = '' then
      raise exception 'automation_eligibility_reason_required';
    end if;

    if v_condition ? 'evidence'
       and jsonb_typeof(v_condition->'evidence') <> 'object' then
      raise exception 'automation_eligibility_evidence_must_be_object';
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_automation_eligibility_conditions(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.record_automation_eligibility_evaluation(
  p_instance_id uuid,
  p_version_number integer,
  p_candidate_key text,
  p_candidate_occurred_at timestamptz,
  p_phase public.automation_eligibility_phase,
  p_conditions jsonb default '[]'::jsonb,
  p_event_id uuid default null,
  p_subject_entity_type text default null,
  p_subject_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.automation_instances%rowtype;
  v_event_studio_id uuid;
  v_system_conditions jsonb;
  v_all_conditions jsonb;
  v_exclusion_reasons jsonb;
  v_eligible boolean;
  v_outcome public.automation_eligibility_outcome;
  v_evaluation_id uuid;
begin
  if p_instance_id is null then
    raise exception 'automation_eligibility_instance_required';
  end if;

  if p_version_number is null or p_version_number < 1 then
    raise exception 'automation_eligibility_version_invalid';
  end if;

  if trim(coalesce(p_candidate_key, '')) = '' then
    raise exception 'automation_eligibility_candidate_key_required';
  end if;

  if p_candidate_occurred_at is null then
    raise exception 'automation_eligibility_candidate_time_required';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'automation_eligibility_metadata_must_be_object';
  end if;

  if (p_subject_entity_type is null) <> (p_subject_entity_id is null) then
    raise exception 'automation_eligibility_subject_pair_required';
  end if;

  if p_subject_entity_type is not null
     and trim(p_subject_entity_type) = '' then
    raise exception 'automation_eligibility_subject_type_required';
  end if;

  perform private.assert_automation_eligibility_conditions(coalesce(p_conditions, '[]'::jsonb));

  select *
    into v_instance
  from public.automation_instances
  where id = p_instance_id;

  if not found then
    raise exception 'automation_instance_not_found';
  end if;

  if not exists (
    select 1
    from public.automation_instance_versions v
    where v.instance_id = v_instance.id
      and v.version_number = p_version_number
  ) then
    raise exception 'automation_instance_version_not_found';
  end if;

  if p_event_id is not null then
    select e.studio_id
      into v_event_studio_id
    from public.domain_events e
    where e.event_id = p_event_id;

    if v_event_studio_id is null then
      raise exception 'automation_eligibility_event_not_found';
    end if;

    if v_event_studio_id <> v_instance.studio_id then
      raise exception 'automation_eligibility_event_studio_mismatch';
    end if;
  end if;

  v_system_conditions := jsonb_build_array(
    jsonb_build_object(
      'key', 'instance.active',
      'kind', 'protected',
      'applies', true,
      'passed', v_instance.status = 'active',
      'reason_code', 'instance_not_active',
      'reason', 'La automatización ya no está activa.',
      'evidence', jsonb_build_object('status', v_instance.status::text)
    ),
    jsonb_build_object(
      'key', 'instance.version_current',
      'kind', 'protected',
      'applies', true,
      'passed', p_version_number = v_instance.current_version_number,
      'reason_code', 'configuration_version_changed',
      'reason', 'La configuración cambió después de crear el candidato.',
      'evidence', jsonb_build_object(
        'candidate_version_number', p_version_number,
        'current_version_number', v_instance.current_version_number
      )
    ),
    jsonb_build_object(
      'key', 'instance.temporal_boundary',
      'kind', 'protected',
      'applies', true,
      'passed', (
        v_instance.eligible_from is not null
        and p_candidate_occurred_at >= v_instance.eligible_from
      ),
      'reason_code', 'candidate_before_eligible_from',
      'reason', 'El candidato pertenece a un periodo anterior a la activación/configuración vigente.',
      'evidence', jsonb_build_object(
        'candidate_occurred_at', p_candidate_occurred_at,
        'eligible_from', v_instance.eligible_from
      )
    )
  );

  v_all_conditions := v_system_conditions || coalesce(p_conditions, '[]'::jsonb);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'condition_key', condition->>'key',
        'reason_code', condition->>'reason_code',
        'reason', condition->>'reason'
      )
      order by ordinality
    ) filter (
      where coalesce((condition->>'applies')::boolean, false)
        and not coalesce((condition->>'passed')::boolean, false)
    ),
    '[]'::jsonb
  )
  into v_exclusion_reasons
  from jsonb_array_elements(v_all_conditions) with ordinality as c(condition, ordinality);

  v_eligible := jsonb_array_length(v_exclusion_reasons) = 0;

  if v_eligible then
    v_outcome := 'proceed';
  elsif p_phase = 'revalidation' then
    v_outcome := 'cancel';
  else
    v_outcome := 'skip';
  end if;

  insert into public.automation_eligibility_evaluations (
    studio_id,
    instance_id,
    version_number,
    catalog_code,
    candidate_key,
    candidate_occurred_at,
    event_id,
    subject_entity_type,
    subject_entity_id,
    phase,
    decision,
    outcome,
    conditions,
    exclusion_reasons,
    metadata,
    evaluated_at,
    created_at
  ) values (
    v_instance.studio_id,
    v_instance.id,
    p_version_number,
    v_instance.catalog_code,
    trim(p_candidate_key),
    p_candidate_occurred_at,
    p_event_id,
    nullif(trim(coalesce(p_subject_entity_type, '')), ''),
    p_subject_entity_id,
    p_phase,
    case when v_eligible then 'eligible' else 'ineligible' end,
    v_outcome,
    v_all_conditions,
    v_exclusion_reasons,
    p_metadata,
    clock_timestamp(),
    clock_timestamp()
  )
  returning id into v_evaluation_id;

  return jsonb_build_object(
    'evaluation_id', v_evaluation_id,
    'eligible', v_eligible,
    'outcome', v_outcome,
    'exclusion_reasons', v_exclusion_reasons
  );
end;
$$;

revoke all on function public.record_automation_eligibility_evaluation(
  uuid,integer,text,timestamptz,public.automation_eligibility_phase,jsonb,uuid,text,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.record_automation_eligibility_evaluation(
  uuid,integer,text,timestamptz,public.automation_eligibility_phase,jsonb,uuid,text,uuid,jsonb
) to service_role;
