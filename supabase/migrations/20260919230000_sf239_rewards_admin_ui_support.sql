create or replace function private.assert_reward_admin_json(
  p_value jsonb,
  p_code text
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '%', p_code;
  end if;
end;
$$;

revoke all on function private.assert_reward_admin_json(jsonb,text)
from public, anon, authenticated, service_role;

create or replace function private.reward_admin_family(
  p_family text
)
returns public.reward_rule_family
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  case trim(coalesce(p_family, ''))
    when 'loyalty' then return 'loyalty';
    when 'attendance' then return 'attendance';
    when 'challenge' then return 'challenge';
    when 'achievement' then return 'achievement';
    else raise exception 'reward_rule_family_invalid';
  end case;
end;
$$;

revoke all on function private.reward_admin_family(text)
from public, anon, authenticated, service_role;

create or replace function private.reward_admin_kind(
  p_kind text
)
returns public.reward_kind
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  case trim(coalesce(p_kind, ''))
    when 'percentage_discount' then return 'percentage_discount';
    when 'fixed_discount' then return 'fixed_discount';
    when 'credits' then return 'credits';
    when 'validity_extension' then return 'validity_extension';
    when 'surcharge_waiver' then return 'surcharge_waiver';
    when 'special_benefit' then return 'special_benefit';
    when 'badge' then return 'badge';
    when 'custom_manual' then return 'custom_manual';
    else raise exception 'reward_kind_invalid';
  end case;
end;
$$;

revoke all on function private.reward_admin_kind(text)
from public, anon, authenticated, service_role;

create or replace function public.admin_create_reward_rule(
  p_studio_id uuid,
  p_name text,
  p_description text,
  p_family text,
  p_audience_definition jsonb,
  p_condition_definition jsonb,
  p_evaluation_definition jsonb,
  p_cycle_definition jsonb,
  p_reward_definition jsonb,
  p_presentation_definition jsonb,
  p_communication_definition jsonb,
  p_incident_definition jsonb,
  p_human_summary text,
  p_scheduled_start_at timestamptz default null,
  p_scheduled_end_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_id uuid := gen_random_uuid();
  v_family public.reward_rule_family;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if p_studio_id is null or not private.has_capability(p_studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'reward_rule_name_required'; end if;
  if trim(coalesce(p_human_summary, '')) = '' then
    raise exception 'reward_rule_human_summary_required';
  end if;
  if p_scheduled_start_at is not null
     and p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'reward_rule_schedule_invalid';
  end if;

  perform private.assert_reward_admin_json(p_audience_definition, 'reward_audience_invalid');
  perform private.assert_reward_admin_json(p_condition_definition, 'reward_condition_invalid');
  perform private.assert_reward_admin_json(p_evaluation_definition, 'reward_evaluation_invalid');
  perform private.assert_reward_admin_json(p_cycle_definition, 'reward_cycle_invalid');
  perform private.assert_reward_admin_json(p_reward_definition, 'reward_definition_invalid');
  perform private.assert_reward_admin_json(p_presentation_definition, 'reward_presentation_invalid');
  perform private.assert_reward_admin_json(p_communication_definition, 'reward_communication_invalid');
  perform private.assert_reward_admin_json(p_incident_definition, 'reward_incident_definition_invalid');

  v_family := private.reward_admin_family(p_family);

  insert into public.reward_rules (
    id,
    studio_id,
    status,
    current_version_number,
    scheduled_start_at,
    scheduled_end_at,
    created_by_user_id,
    updated_by_user_id
  ) values (
    v_rule_id,
    p_studio_id,
    'draft',
    1,
    p_scheduled_start_at,
    p_scheduled_end_at,
    v_user_id,
    v_user_id
  );

  insert into public.reward_rule_versions (
    studio_id,
    rule_id,
    version_number,
    name,
    description,
    family,
    audience_definition,
    condition_definition,
    evaluation_definition,
    cycle_definition,
    reward_definition,
    presentation_definition,
    communication_definition,
    incident_definition,
    human_summary,
    created_by_user_id
  ) values (
    p_studio_id,
    v_rule_id,
    1,
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    v_family,
    p_audience_definition,
    p_condition_definition,
    p_evaluation_definition,
    p_cycle_definition,
    p_reward_definition,
    p_presentation_definition,
    p_communication_definition,
    p_incident_definition,
    trim(p_human_summary),
    v_user_id
  );

  insert into public.reward_rule_lifecycle (
    studio_id,
    rule_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    p_studio_id,
    v_rule_id,
    'created',
    null,
    'draft',
    1,
    v_user_id,
    'created_from_admin_ui'
  );

  return v_rule_id;
end;
$$;

revoke all on function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
grant execute on function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated;

create or replace function public.admin_create_reward_rule_version(
  p_rule_id uuid,
  p_name text,
  p_description text,
  p_family text,
  p_audience_definition jsonb,
  p_condition_definition jsonb,
  p_evaluation_definition jsonb,
  p_cycle_definition jsonb,
  p_reward_definition jsonb,
  p_presentation_definition jsonb,
  p_communication_definition jsonb,
  p_incident_definition jsonb,
  p_human_summary text,
  p_scheduled_start_at timestamptz default null,
  p_scheduled_end_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_next integer;
  v_family public.reward_rule_family;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select * into v_rule
  from public.reward_rules
  where id = p_rule_id
  for update;

  if not found then raise exception 'reward_rule_not_found'; end if;
  if not private.has_capability(v_rule.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;
  if v_rule.status in ('finished', 'cancelled') then
    raise exception 'reward_rule_terminal';
  end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'reward_rule_name_required'; end if;
  if trim(coalesce(p_human_summary, '')) = '' then
    raise exception 'reward_rule_human_summary_required';
  end if;
  if p_scheduled_start_at is not null
     and p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'reward_rule_schedule_invalid';
  end if;

  perform private.assert_reward_admin_json(p_audience_definition, 'reward_audience_invalid');
  perform private.assert_reward_admin_json(p_condition_definition, 'reward_condition_invalid');
  perform private.assert_reward_admin_json(p_evaluation_definition, 'reward_evaluation_invalid');
  perform private.assert_reward_admin_json(p_cycle_definition, 'reward_cycle_invalid');
  perform private.assert_reward_admin_json(p_reward_definition, 'reward_definition_invalid');
  perform private.assert_reward_admin_json(p_presentation_definition, 'reward_presentation_invalid');
  perform private.assert_reward_admin_json(p_communication_definition, 'reward_communication_invalid');
  perform private.assert_reward_admin_json(p_incident_definition, 'reward_incident_definition_invalid');

  v_family := private.reward_admin_family(p_family);
  v_next := v_rule.current_version_number + 1;

  insert into public.reward_rule_versions (
    studio_id,
    rule_id,
    version_number,
    name,
    description,
    family,
    audience_definition,
    condition_definition,
    evaluation_definition,
    cycle_definition,
    reward_definition,
    presentation_definition,
    communication_definition,
    incident_definition,
    human_summary,
    created_by_user_id
  ) values (
    v_rule.studio_id,
    v_rule.id,
    v_next,
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    v_family,
    p_audience_definition,
    p_condition_definition,
    p_evaluation_definition,
    p_cycle_definition,
    p_reward_definition,
    p_presentation_definition,
    p_communication_definition,
    p_incident_definition,
    trim(p_human_summary),
    v_user_id
  );

  update public.reward_rules
  set current_version_number = v_next,
      scheduled_start_at = p_scheduled_start_at,
      scheduled_end_at = p_scheduled_end_at,
      updated_by_user_id = v_user_id,
      updated_at = clock_timestamp()
  where id = v_rule.id;

  insert into public.reward_rule_lifecycle (
    studio_id,
    rule_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_rule.studio_id,
    v_rule.id,
    'version_created',
    v_rule.status,
    v_rule.status,
    v_next,
    v_user_id,
    'structural_edit_from_admin_ui'
  );

  return v_next;
end;
$$;

revoke all on function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
grant execute on function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated;

create or replace function public.admin_transition_reward_rule(
  p_rule_id uuid,
  p_action text,
  p_note text default null
)
returns public.reward_rule_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_next public.reward_rule_status;
  v_operation text;
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select * into v_rule
  from public.reward_rules
  where id = p_rule_id
  for update;

  if not found then raise exception 'reward_rule_not_found'; end if;
  if not private.has_capability(v_rule.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;

  case trim(coalesce(p_action, ''))
    when 'schedule' then
      if v_rule.status <> 'draft' or v_rule.scheduled_start_at is null then
        raise exception 'reward_rule_schedule_transition_invalid';
      end if;
      v_next := 'scheduled';
      v_operation := 'scheduled';
    when 'activate' then
      if v_rule.status not in ('draft', 'scheduled', 'paused') then
        raise exception 'reward_rule_activate_transition_invalid';
      end if;
      v_next := 'active';
      v_operation := case when v_rule.status = 'paused' then 'reactivated' else 'activated' end;
    when 'pause' then
      if v_rule.status <> 'active' then raise exception 'reward_rule_pause_transition_invalid'; end if;
      v_next := 'paused';
      v_operation := 'paused';
    when 'finish' then
      if v_rule.status not in ('active', 'paused', 'scheduled') then
        raise exception 'reward_rule_finish_transition_invalid';
      end if;
      v_next := 'finished';
      v_operation := 'finished';
    when 'cancel' then
      if v_rule.status in ('finished', 'cancelled') then
        raise exception 'reward_rule_cancel_transition_invalid';
      end if;
      v_next := 'cancelled';
      v_operation := 'cancelled';
    else
      raise exception 'reward_rule_action_invalid';
  end case;

  update public.reward_rules
  set status = v_next,
      first_activated_at = case
        when v_next = 'active' then coalesce(first_activated_at, v_now)
        else first_activated_at
      end,
      last_activated_at = case when v_next = 'active' then v_now else last_activated_at end,
      paused_at = case when v_next = 'paused' then v_now else paused_at end,
      finished_at = case when v_next = 'finished' then v_now else finished_at end,
      cancelled_at = case when v_next = 'cancelled' then v_now else cancelled_at end,
      updated_by_user_id = v_user_id,
      updated_at = v_now
  where id = v_rule.id;

  insert into public.reward_rule_lifecycle (
    studio_id,
    rule_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_rule.studio_id,
    v_rule.id,
    v_operation,
    v_rule.status,
    v_next,
    v_rule.current_version_number,
    v_user_id,
    nullif(trim(coalesce(p_note, '')), '')
  );

  return v_next;
end;
$$;

revoke all on function public.admin_transition_reward_rule(uuid,text,text)
from public, anon;
grant execute on function public.admin_transition_reward_rule(uuid,text,text)
to authenticated;

create or replace function public.admin_duplicate_reward_rule(
  p_rule_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_new_rule uuid := gen_random_uuid();
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found then raise exception 'reward_rule_not_found'; end if;
  if not private.has_capability(v_rule.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number;

  if not found then raise exception 'reward_rule_version_not_found'; end if;

  insert into public.reward_rules (
    id,
    studio_id,
    status,
    current_version_number,
    created_by_user_id,
    updated_by_user_id
  ) values (
    v_new_rule,
    v_rule.studio_id,
    'draft',
    1,
    v_user_id,
    v_user_id
  );

  insert into public.reward_rule_versions (
    studio_id,
    rule_id,
    version_number,
    name,
    description,
    family,
    audience_definition,
    condition_definition,
    evaluation_definition,
    cycle_definition,
    reward_definition,
    presentation_definition,
    communication_definition,
    incident_definition,
    human_summary,
    created_by_user_id
  ) values (
    v_rule.studio_id,
    v_new_rule,
    1,
    v_version.name || ' · copia',
    v_version.description,
    v_version.family,
    v_version.audience_definition,
    v_version.condition_definition,
    v_version.evaluation_definition,
    v_version.cycle_definition,
    v_version.reward_definition,
    v_version.presentation_definition,
    v_version.communication_definition,
    v_version.incident_definition,
    v_version.human_summary,
    v_user_id
  );

  insert into public.reward_rule_lifecycle (
    studio_id,
    rule_id,
    operation,
    from_status,
    to_status,
    version_number,
    actor_user_id,
    note
  ) values (
    v_rule.studio_id,
    v_new_rule,
    'created',
    null,
    'draft',
    1,
    v_user_id,
    'duplicated_from:' || v_rule.id::text
  );

  return v_new_rule;
end;
$$;

revoke all on function public.admin_duplicate_reward_rule(uuid)
from public, anon;
grant execute on function public.admin_duplicate_reward_rule(uuid)
to authenticated;

create or replace function public.admin_grant_manual_reward(
  p_student_id uuid,
  p_kind text,
  p_benefit_definition jsonb,
  p_reason text,
  p_validity_days integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_kind public.reward_kind;
  v_reward_id uuid;
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if p_student_id is null then raise exception 'reward_student_required'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'reward_manual_reason_required'; end if;
  if p_validity_days is not null and p_validity_days < 0 then
    raise exception 'reward_validity_days_invalid';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_student.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;

  perform private.assert_reward_admin_json(p_benefit_definition, 'reward_definition_invalid');
  v_kind := private.reward_admin_kind(p_kind);

  insert into public.reward_instances (
    studio_id,
    student_id,
    kind,
    status,
    idempotency_key,
    benefit_definition,
    origin_snapshot,
    available_from,
    expires_at,
    manually_granted,
    manual_reason,
    created_by_user_id,
    reward_key,
    delivery_mode
  ) values (
    v_student.studio_id,
    v_student.id,
    v_kind,
    'available',
    'manual:' || gen_random_uuid()::text,
    p_benefit_definition,
    jsonb_build_object(
      'source', 'admin_manual_grant',
      'reason', trim(p_reason),
      'actor_user_id', v_user_id
    ),
    v_now,
    case when p_validity_days is null then null else v_now + make_interval(days => p_validity_days) end,
    true,
    trim(p_reason),
    v_user_id,
    'manual',
    'redeem'
  )
  returning id into v_reward_id;

  insert into public.reward_instance_events (
    studio_id,
    reward_instance_id,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    details,
    occurred_at
  ) values (
    v_student.studio_id,
    v_reward_id,
    'created',
    null,
    'available',
    v_user_id,
    jsonb_build_object('manual', true, 'reason', trim(p_reason)),
    v_now
  );

  return v_reward_id;
end;
$$;

revoke all on function public.admin_grant_manual_reward(uuid,text,jsonb,text,integer)
from public, anon;
grant execute on function public.admin_grant_manual_reward(uuid,text,jsonb,text,integer)
to authenticated;
