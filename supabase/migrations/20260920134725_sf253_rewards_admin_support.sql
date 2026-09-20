
create or replace function public.admin_publish_reward_program_with_runtime(
  p_program_id uuid,
  p_note text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_version integer;
  v_new_version integer;
  v_rule record;
  v_status public.reward_rule_status;
begin
  select published_version_number
    into v_old_version
  from public.reward_programs
  where id = p_program_id;

  if not found then
    raise exception 'reward_program_not_found';
  end if;

  v_new_version :=
    private.admin_publish_reward_program_internal(
      p_program_id,
      p_note
    );

  for v_rule in
    select distinct l.rule_id
    from public.reward_program_levels l
    where l.program_id = p_program_id
      and l.program_version_number = v_new_version
  loop
    select status into v_status
    from public.reward_rules
    where id = v_rule.rule_id
    for update;

    if v_status in ('draft','scheduled','paused') then
      perform private.admin_transition_reward_rule_internal(
        v_rule.rule_id,
        'activate',
        'program_version_published'
      );
    elsif v_status <> 'active' then
      raise exception 'reward_program_level_rule_not_activatable:%:%',
        v_rule.rule_id, v_status;
    end if;
  end loop;

  if v_old_version is not null and v_old_version <> v_new_version then
    for v_rule in
      select distinct old_l.rule_id
      from public.reward_program_levels old_l
      join public.reward_rule_versions rv
        on rv.rule_id = old_l.rule_id
       and rv.version_number = old_l.rule_version_number
      where old_l.program_id = p_program_id
        and old_l.program_version_number = v_old_version
        and coalesce(
          (rv.presentation_definition->>'managed_by_program')::boolean,
          false
        )
        and not exists (
          select 1
          from public.reward_program_levels new_l
          where new_l.program_id = p_program_id
            and new_l.program_version_number = v_new_version
            and new_l.rule_id = old_l.rule_id
        )
    loop
      select status into v_status
      from public.reward_rules
      where id = v_rule.rule_id
      for update;

      if v_status in ('active','paused','scheduled') then
        perform private.admin_transition_reward_rule_internal(
          v_rule.rule_id,
          'finish',
          'program_version_replaced'
        );
      elsif v_status = 'draft' then
        perform private.admin_transition_reward_rule_internal(
          v_rule.rule_id,
          'cancel',
          'program_version_replaced'
        );
      end if;
    end loop;
  end if;

  return v_new_version;
end;
$$;

revoke all on function public.admin_publish_reward_program_with_runtime(uuid,text)
from public, anon;
grant execute on function public.admin_publish_reward_program_with_runtime(uuid,text)
to authenticated;

create or replace function public.admin_adjust_reward_instance(
  p_reward_instance_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason,''));
  v_incident_id uuid;
  v_result jsonb;
begin
  if v_reason = '' then
    raise exception 'reward_adjustment_reason_required';
  end if;

  v_incident_id :=
    private.admin_request_reward_review_internal(
      p_reward_instance_id,
      v_reason
    );

  v_result :=
    private.admin_resolve_reward_incident_internal(
      v_incident_id,
      'revoke_reward',
      v_reason,
      jsonb_build_object(
        'surface','generated_rewards',
        'operation','exceptional_adjustment'
      )
    );

  return v_result || jsonb_build_object(
    'adjustment_reason',
    v_reason
  );
end;
$$;

revoke all on function public.admin_adjust_reward_instance(uuid,text)
from public, anon;
grant execute on function public.admin_adjust_reward_instance(uuid,text)
to authenticated;
