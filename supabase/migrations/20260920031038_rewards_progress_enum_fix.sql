-- Corrective patch for SF-235 canonical progress RPC.
-- PostgreSQL CASE must resolve to reward_participation_status, not text.

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
    set status = case when p_fulfilled then 'fulfilled'::public.reward_participation_status else 'in_progress'::public.reward_participation_status end,
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
