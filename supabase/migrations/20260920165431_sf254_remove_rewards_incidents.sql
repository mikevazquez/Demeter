create or replace function private.reward_progress_program_completion_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfilled then
    perform public.system_record_reward_program_level_completion(new.id);
  end if;
  return new;
end;
$$;

create or replace function private.reward_try_process_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type in (
    'attendance.finalized',
    'attendance.corrected',
    'attendance.cancelled',
    'loyalty.changed'
  ) then
    begin
      perform public.system_process_reward_domain_event(new.event_id);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

create or replace function private.revoke_reward_available_internal(
  p_reward_instance_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns public.reward_instance_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_reward_instance_id is null then raise exception 'reward_instance_id_required'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'reward_revocation_reason_required'; end if;

  select *
    into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then raise exception 'reward_instance_not_found'; end if;

  if v_reward.status = 'revoked' then return 'revoked'; end if;
  if v_reward.status = 'redeemed' then
    raise exception 'reward_redeemed_never_reopened';
  end if;
  if v_reward.status not in ('blocked', 'available', 'reserved') then
    raise exception 'reward_revocation_transition_invalid:%', v_reward.status;
  end if;

  update public.reward_instances
  set status = 'revoked',
      revoked_at = v_now,
      revoked_reason = trim(p_reason),
      updated_at = v_now
  where id = v_reward.id;

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
    v_reward.studio_id,
    v_reward.id,
    'revoked',
    v_reward.status,
    'revoked',
    p_actor_user_id,
    jsonb_build_object('reason', trim(p_reason)),
    v_now
  );

  return 'revoked';
end;
$$;

revoke all on function private.revoke_reward_available_internal(uuid,text,uuid)
from public, anon, authenticated, service_role;

create or replace function public.system_reconcile_reward_correction(
  p_new_evaluation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.reward_progress_evaluations%rowtype;
  v_previous public.reward_progress_evaluations%rowtype;
  v_reward public.reward_instances%rowtype;
  v_revoked integer := 0;
  v_redeemed_preserved integer := 0;
  v_unchanged integer := 0;
begin
  if p_new_evaluation_id is null then
    raise exception 'reward_correction_evaluation_required';
  end if;

  select * into v_new
  from public.reward_progress_evaluations
  where id = p_new_evaluation_id;

  if not found then raise exception 'reward_progress_evaluation_not_found'; end if;
  if v_new.evaluation_kind <> 'recalculation' or v_new.outcome <> 'recalculated' then
    raise exception 'reward_correction_recalculation_required';
  end if;
  if v_new.supersedes_evaluation_id is null then
    raise exception 'reward_correction_supersedes_required';
  end if;

  select * into v_previous
  from public.reward_progress_evaluations
  where id = v_new.supersedes_evaluation_id;

  if not found then raise exception 'reward_correction_previous_evaluation_not_found'; end if;
  if v_previous.studio_id <> v_new.studio_id
     or v_previous.cycle_id <> v_new.cycle_id
     or v_previous.student_id <> v_new.student_id then
    raise exception 'reward_correction_context_mismatch';
  end if;

  if v_new.fulfilled then
    return jsonb_build_object(
      'evaluation_id', v_new.id,
      'previous_fulfilled', v_previous.fulfilled,
      'now_fulfilled', true,
      'grant_required', not v_previous.fulfilled,
      'revoked', 0,
      'redeemed_preserved', 0,
      'unchanged', 0
    );
  end if;

  if not v_previous.fulfilled then
    return jsonb_build_object(
      'evaluation_id', v_new.id,
      'previous_fulfilled', false,
      'now_fulfilled', false,
      'grant_required', false,
      'revoked', 0,
      'redeemed_preserved', 0,
      'unchanged', 0
    );
  end if;

  for v_reward in
    select *
    from public.reward_instances
    where studio_id = v_new.studio_id
      and student_id = v_new.student_id
      and cycle_id = v_new.cycle_id
      and (
        source_evaluation_id = v_previous.id
        or source_evaluation_id = v_new.supersedes_evaluation_id
      )
    order by created_at, id
    for update
  loop
    if v_reward.status in ('blocked', 'available', 'reserved') then
      perform private.revoke_reward_available_internal(
        v_reward.id,
        'progress_correction:' || v_new.id::text,
        null
      );
      v_revoked := v_revoked + 1;
    elsif v_reward.status = 'redeemed' then
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
        v_reward.studio_id,
        v_reward.id,
        'adjusted',
        'redeemed',
        'redeemed',
        null,
        jsonb_build_object(
          'reason', 'progress_correction_after_redemption',
          'new_evaluation_id', v_new.id,
          'previous_evaluation_id', v_previous.id,
          'redemption_context', v_reward.redemption_context
        ),
        clock_timestamp()
      );
      v_redeemed_preserved := v_redeemed_preserved + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'evaluation_id', v_new.id,
    'previous_fulfilled', true,
    'now_fulfilled', false,
    'grant_required', false,
    'revoked', v_revoked,
    'redeemed_preserved', v_redeemed_preserved,
    'unchanged', v_unchanged
  );
end;
$$;

revoke all on function public.system_reconcile_reward_correction(uuid)
from public, anon, authenticated;
grant execute on function public.system_reconcile_reward_correction(uuid)
to service_role;

create or replace function private.admin_adjust_reward_instance_internal(
  p_reward_instance_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.reward_instances%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_user_id uuid := (select auth.uid());
  v_status public.reward_instance_status;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if v_reason = '' then raise exception 'reward_adjustment_reason_required'; end if;

  select * into v_reward
  from public.reward_instances
  where id = p_reward_instance_id
  for update;

  if not found then raise exception 'reward_instance_not_found'; end if;
  if not private.has_capability(v_reward.studio_id, 'rewards.manage') then
    raise exception 'forbidden';
  end if;
  if v_reward.status not in ('blocked', 'available') then
    raise exception 'reward_adjustment_not_allowed:%', v_reward.status;
  end if;

  v_status := private.revoke_reward_available_internal(
    v_reward.id,
    v_reason,
    v_user_id
  );

  return jsonb_build_object(
    'reward_instance_id', v_reward.id,
    'status', v_status,
    'adjustment_reason', v_reason
  );
end;
$$;

revoke all on function private.admin_adjust_reward_instance_internal(uuid,text)
from public, anon;
grant execute on function private.admin_adjust_reward_instance_internal(uuid,text)
to authenticated, service_role;

create or replace function public.admin_adjust_reward_instance(
  p_reward_instance_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_adjust_reward_instance_internal(
    p_reward_instance_id,
    p_reason
  );
$$;

revoke all on function public.admin_adjust_reward_instance(uuid,text)
from public, anon;
grant execute on function public.admin_adjust_reward_instance(uuid,text)
to authenticated, service_role;

create or replace function private.admin_duplicate_reward_rule_internal(
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

  select * into v_rule from public.reward_rules where id = p_rule_id;
  if not found then raise exception 'reward_rule_not_found'; end if;
  if not private.has_capability(v_rule.studio_id, 'rewards.manage') then raise exception 'forbidden'; end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = v_rule.id and version_number = v_rule.current_version_number;
  if not found then raise exception 'reward_rule_version_not_found'; end if;

  insert into public.reward_rules (
    id,studio_id,status,current_version_number,created_by_user_id,updated_by_user_id
  ) values (
    v_new_rule,v_rule.studio_id,'draft',1,v_user_id,v_user_id
  );

  insert into public.reward_rule_versions (
    studio_id,rule_id,version_number,name,description,family,
    audience_definition,condition_definition,evaluation_definition,cycle_definition,
    reward_definition,presentation_definition,communication_definition,human_summary,created_by_user_id
  ) values (
    v_rule.studio_id,v_new_rule,1,v_version.name || ' · copia',v_version.description,v_version.family,
    v_version.audience_definition,v_version.condition_definition,v_version.evaluation_definition,
    v_version.cycle_definition,v_version.reward_definition,v_version.presentation_definition,
    v_version.communication_definition,v_version.human_summary,v_user_id
  );

  insert into public.reward_rule_lifecycle (
    studio_id,rule_id,operation,from_status,to_status,version_number,actor_user_id,note
  ) values (
    v_rule.studio_id,v_new_rule,'created',null,'draft',1,v_user_id,
    'duplicated_from:' || v_rule.id::text
  );

  return v_new_rule;
end;
$$;

drop function if exists public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
);
drop function if exists public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
);
drop function if exists private.admin_create_reward_rule_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
);
drop function if exists private.admin_create_reward_rule_version_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
);

create function private.admin_create_reward_rule_internal(
  p_studio_id uuid,p_name text,p_description text,p_family text,
  p_audience_definition jsonb,p_condition_definition jsonb,p_evaluation_definition jsonb,
  p_cycle_definition jsonb,p_reward_definition jsonb,p_presentation_definition jsonb,
  p_communication_definition jsonb,p_human_summary text,
  p_scheduled_start_at timestamptz default null,p_scheduled_end_at timestamptz default null
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
  if p_studio_id is null or not private.has_capability(p_studio_id, 'rewards.manage') then raise exception 'forbidden'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'reward_rule_name_required'; end if;
  if trim(coalesce(p_human_summary, '')) = '' then raise exception 'reward_rule_human_summary_required'; end if;
  if p_scheduled_start_at is not null and p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then raise exception 'reward_rule_schedule_invalid'; end if;

  perform private.assert_reward_admin_json(p_audience_definition, 'reward_audience_invalid');
  perform private.assert_reward_admin_json(p_condition_definition, 'reward_condition_invalid');
  perform private.assert_reward_admin_json(p_evaluation_definition, 'reward_evaluation_invalid');
  perform private.assert_reward_admin_json(p_cycle_definition, 'reward_cycle_invalid');
  perform private.assert_reward_admin_json(p_reward_definition, 'reward_definition_invalid');
  perform private.assert_reward_admin_json(p_presentation_definition, 'reward_presentation_invalid');
  perform private.assert_reward_admin_json(p_communication_definition, 'reward_communication_invalid');

  v_family := private.reward_admin_family(p_family);

  insert into public.reward_rules (
    id,studio_id,status,current_version_number,scheduled_start_at,scheduled_end_at,
    created_by_user_id,updated_by_user_id
  ) values (
    v_rule_id,p_studio_id,'draft',1,p_scheduled_start_at,p_scheduled_end_at,v_user_id,v_user_id
  );

  insert into public.reward_rule_versions (
    studio_id,rule_id,version_number,name,description,family,
    audience_definition,condition_definition,evaluation_definition,cycle_definition,
    reward_definition,presentation_definition,communication_definition,human_summary,created_by_user_id
  ) values (
    p_studio_id,v_rule_id,1,trim(p_name),nullif(trim(coalesce(p_description, '')), ''),v_family,
    p_audience_definition,p_condition_definition,p_evaluation_definition,p_cycle_definition,
    p_reward_definition,p_presentation_definition,p_communication_definition,trim(p_human_summary),v_user_id
  );

  insert into public.reward_rule_lifecycle (
    studio_id,rule_id,operation,from_status,to_status,version_number,actor_user_id,note
  ) values (
    p_studio_id,v_rule_id,'created',null,'draft',1,v_user_id,'created_from_admin_ui'
  );

  return v_rule_id;
end;
$$;

revoke all on function private.admin_create_reward_rule_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
grant execute on function private.admin_create_reward_rule_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated, service_role;

create function public.admin_create_reward_rule(
  p_studio_id uuid,p_name text,p_description text,p_family text,
  p_audience_definition jsonb,p_condition_definition jsonb,p_evaluation_definition jsonb,
  p_cycle_definition jsonb,p_reward_definition jsonb,p_presentation_definition jsonb,
  p_communication_definition jsonb,p_human_summary text,
  p_scheduled_start_at timestamptz default null,p_scheduled_end_at timestamptz default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_reward_rule_internal(
    p_studio_id,p_name,p_description,p_family,p_audience_definition,p_condition_definition,
    p_evaluation_definition,p_cycle_definition,p_reward_definition,p_presentation_definition,
    p_communication_definition,p_human_summary,p_scheduled_start_at,p_scheduled_end_at
  );
$$;

revoke all on function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
grant execute on function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated, service_role;

create function private.admin_create_reward_rule_version_internal(
  p_rule_id uuid,p_name text,p_description text,p_family text,
  p_audience_definition jsonb,p_condition_definition jsonb,p_evaluation_definition jsonb,
  p_cycle_definition jsonb,p_reward_definition jsonb,p_presentation_definition jsonb,
  p_communication_definition jsonb,p_human_summary text,
  p_scheduled_start_at timestamptz default null,p_scheduled_end_at timestamptz default null
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
  select * into v_rule from public.reward_rules where id = p_rule_id for update;
  if not found then raise exception 'reward_rule_not_found'; end if;
  if not private.has_capability(v_rule.studio_id, 'rewards.manage') then raise exception 'forbidden'; end if;
  if v_rule.status in ('finished', 'cancelled') then raise exception 'reward_rule_terminal'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'reward_rule_name_required'; end if;
  if trim(coalesce(p_human_summary, '')) = '' then raise exception 'reward_rule_human_summary_required'; end if;
  if p_scheduled_start_at is not null and p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then raise exception 'reward_rule_schedule_invalid'; end if;

  perform private.assert_reward_admin_json(p_audience_definition, 'reward_audience_invalid');
  perform private.assert_reward_admin_json(p_condition_definition, 'reward_condition_invalid');
  perform private.assert_reward_admin_json(p_evaluation_definition, 'reward_evaluation_invalid');
  perform private.assert_reward_admin_json(p_cycle_definition, 'reward_cycle_invalid');
  perform private.assert_reward_admin_json(p_reward_definition, 'reward_definition_invalid');
  perform private.assert_reward_admin_json(p_presentation_definition, 'reward_presentation_invalid');
  perform private.assert_reward_admin_json(p_communication_definition, 'reward_communication_invalid');

  v_family := private.reward_admin_family(p_family);
  v_next := v_rule.current_version_number + 1;

  insert into public.reward_rule_versions (
    studio_id,rule_id,version_number,name,description,family,
    audience_definition,condition_definition,evaluation_definition,cycle_definition,
    reward_definition,presentation_definition,communication_definition,human_summary,created_by_user_id
  ) values (
    v_rule.studio_id,v_rule.id,v_next,trim(p_name),nullif(trim(coalesce(p_description, '')), ''),v_family,
    p_audience_definition,p_condition_definition,p_evaluation_definition,p_cycle_definition,
    p_reward_definition,p_presentation_definition,p_communication_definition,trim(p_human_summary),v_user_id
  );

  update public.reward_rules
  set current_version_number=v_next,scheduled_start_at=p_scheduled_start_at,
      scheduled_end_at=p_scheduled_end_at,updated_by_user_id=v_user_id,updated_at=clock_timestamp()
  where id=v_rule.id;

  insert into public.reward_rule_lifecycle (
    studio_id,rule_id,operation,from_status,to_status,version_number,actor_user_id,note
  ) values (
    v_rule.studio_id,v_rule.id,'version_created',v_rule.status,v_rule.status,v_next,v_user_id,
    'structural_edit_from_admin_ui'
  );

  return v_next;
end;
$$;

revoke all on function private.admin_create_reward_rule_version_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
grant execute on function private.admin_create_reward_rule_version_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated, service_role;

create function public.admin_create_reward_rule_version(
  p_rule_id uuid,p_name text,p_description text,p_family text,
  p_audience_definition jsonb,p_condition_definition jsonb,p_evaluation_definition jsonb,
  p_cycle_definition jsonb,p_reward_definition jsonb,p_presentation_definition jsonb,
  p_communication_definition jsonb,p_human_summary text,
  p_scheduled_start_at timestamptz default null,p_scheduled_end_at timestamptz default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_reward_rule_version_internal(
    p_rule_id,p_name,p_description,p_family,p_audience_definition,p_condition_definition,
    p_evaluation_definition,p_cycle_definition,p_reward_definition,p_presentation_definition,
    p_communication_definition,p_human_summary,p_scheduled_start_at,p_scheduled_end_at
  );
$$;

revoke all on function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
grant execute on function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated, service_role;

drop function if exists public.admin_request_reward_review(uuid,text);
drop function if exists public.admin_resolve_reward_incident(uuid,text,text,jsonb);
drop function if exists public.system_open_reward_incident(uuid,uuid,uuid,uuid,text,text,text,jsonb,text);
drop function if exists private.admin_request_reward_review_internal(uuid,text);
drop function if exists private.admin_resolve_reward_incident_internal(uuid,text,text,jsonb);
drop function if exists private.open_reward_incident_internal(
  uuid,uuid,uuid,uuid,text,public.reward_incident_priority,text,jsonb,text,uuid
);
drop function if exists private.reward_incident_priority_from_text(text);

drop table if exists public.reward_incident_events;
drop table if exists public.reward_incidents;

alter table public.reward_rule_versions drop column if exists incident_definition;

drop type if exists public.reward_incident_status;
drop type if exists public.reward_incident_priority;
