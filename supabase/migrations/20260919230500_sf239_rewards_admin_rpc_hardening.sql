alter function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) set schema private;
alter function private.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) rename to admin_create_reward_rule_internal;

alter function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) set schema private;
alter function private.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) rename to admin_create_reward_rule_version_internal;

alter function public.admin_transition_reward_rule(uuid,text,text) set schema private;
alter function private.admin_transition_reward_rule(uuid,text,text)
  rename to admin_transition_reward_rule_internal;

alter function public.admin_duplicate_reward_rule(uuid) set schema private;
alter function private.admin_duplicate_reward_rule(uuid)
  rename to admin_duplicate_reward_rule_internal;

alter function public.admin_grant_manual_reward(uuid,text,jsonb,text,integer) set schema private;
alter function private.admin_grant_manual_reward(uuid,text,jsonb,text,integer)
  rename to admin_grant_manual_reward_internal;

revoke all on function private.admin_create_reward_rule_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
revoke all on function private.admin_create_reward_rule_version_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
revoke all on function private.admin_transition_reward_rule_internal(uuid,text,text)
  from public, anon;
revoke all on function private.admin_duplicate_reward_rule_internal(uuid)
  from public, anon;
revoke all on function private.admin_grant_manual_reward_internal(uuid,text,jsonb,text,integer)
  from public, anon;

grant execute on function private.admin_create_reward_rule_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated;
grant execute on function private.admin_create_reward_rule_version_internal(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated;
grant execute on function private.admin_transition_reward_rule_internal(uuid,text,text)
  to authenticated;
grant execute on function private.admin_duplicate_reward_rule_internal(uuid)
  to authenticated;
grant execute on function private.admin_grant_manual_reward_internal(uuid,text,jsonb,text,integer)
  to authenticated;

create function public.admin_create_reward_rule(
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
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_reward_rule_internal(
    p_studio_id,p_name,p_description,p_family,p_audience_definition,p_condition_definition,
    p_evaluation_definition,p_cycle_definition,p_reward_definition,p_presentation_definition,
    p_communication_definition,p_incident_definition,p_human_summary,p_scheduled_start_at,
    p_scheduled_end_at
  );
$$;

create function public.admin_create_reward_rule_version(
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
language sql
security invoker
set search_path = ''
as $$
  select private.admin_create_reward_rule_version_internal(
    p_rule_id,p_name,p_description,p_family,p_audience_definition,p_condition_definition,
    p_evaluation_definition,p_cycle_definition,p_reward_definition,p_presentation_definition,
    p_communication_definition,p_incident_definition,p_human_summary,p_scheduled_start_at,
    p_scheduled_end_at
  );
$$;

create function public.admin_transition_reward_rule(
  p_rule_id uuid,
  p_action text,
  p_note text default null
)
returns public.reward_rule_status
language sql
security invoker
set search_path = ''
as $$
  select private.admin_transition_reward_rule_internal(p_rule_id,p_action,p_note);
$$;

create function public.admin_duplicate_reward_rule(
  p_rule_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_duplicate_reward_rule_internal(p_rule_id);
$$;

create function public.admin_grant_manual_reward(
  p_student_id uuid,
  p_kind text,
  p_benefit_definition jsonb,
  p_reason text,
  p_validity_days integer default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.admin_grant_manual_reward_internal(
    p_student_id,p_kind,p_benefit_definition,p_reason,p_validity_days
  );
$$;

revoke all on function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
revoke all on function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) from public, anon;
revoke all on function public.admin_transition_reward_rule(uuid,text,text)
  from public, anon;
revoke all on function public.admin_duplicate_reward_rule(uuid)
  from public, anon;
revoke all on function public.admin_grant_manual_reward(uuid,text,jsonb,text,integer)
  from public, anon;

grant execute on function public.admin_create_reward_rule(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated;
grant execute on function public.admin_create_reward_rule_version(
  uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamptz,timestamptz
) to authenticated;
grant execute on function public.admin_transition_reward_rule(uuid,text,text)
  to authenticated;
grant execute on function public.admin_duplicate_reward_rule(uuid)
  to authenticated;
grant execute on function public.admin_grant_manual_reward(uuid,text,jsonb,text,integer)
  to authenticated;
