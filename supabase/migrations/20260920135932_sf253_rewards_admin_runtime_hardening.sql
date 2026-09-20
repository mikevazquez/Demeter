
-- SF-253 hardening: scheduled challenge lifecycle + condition family routing.

create extension if not exists pg_cron;

create or replace function public.system_sync_reward_rule_schedules()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_now timestamptz := clock_timestamp();
  v_activated integer := 0;
  v_finished integer := 0;
begin
  for v_rule in
    select *
    from public.reward_rules
    where (
      status = 'scheduled'
      and scheduled_start_at is not null
      and scheduled_start_at <= v_now
      and (scheduled_end_at is null or scheduled_end_at > v_now)
    )
    or (
      status in ('scheduled','active','paused')
      and scheduled_end_at is not null
      and scheduled_end_at <= v_now
    )
    order by updated_at, id
    for update skip locked
  loop
    if v_rule.scheduled_end_at is not null
       and v_rule.scheduled_end_at <= v_now then
      update public.reward_rules
      set status='finished',
          finished_at=coalesce(finished_at,v_now),
          updated_at=v_now
      where id=v_rule.id;

      insert into public.reward_rule_lifecycle(
        studio_id,rule_id,operation,from_status,to_status,
        version_number,actor_user_id,note
      ) values (
        v_rule.studio_id,v_rule.id,'finished',
        v_rule.status,'finished',v_rule.current_version_number,
        null,'automatic_schedule_end'
      );
      v_finished := v_finished + 1;
    elsif v_rule.status='scheduled'
       and v_rule.scheduled_start_at is not null
       and v_rule.scheduled_start_at <= v_now then
      update public.reward_rules
      set status='active',
          first_activated_at=coalesce(first_activated_at,v_now),
          last_activated_at=v_now,
          updated_at=v_now
      where id=v_rule.id;

      insert into public.reward_rule_lifecycle(
        studio_id,rule_id,operation,from_status,to_status,
        version_number,actor_user_id,note
      ) values (
        v_rule.studio_id,v_rule.id,'activated',
        'scheduled','active',v_rule.current_version_number,
        null,'automatic_schedule_start'
      );
      v_activated := v_activated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'activated',v_activated,
    'finished',v_finished,
    'synced_at',v_now
  );
end;
$$;

revoke all on function public.system_sync_reward_rule_schedules()
from public,anon,authenticated;
grant execute on function public.system_sync_reward_rule_schedules()
to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='sf253_rewards_schedule_sync'
  limit 1;

  if v_jobid is null then
    perform cron.schedule(
      'sf253_rewards_schedule_sync',
      '* * * * *',
      'select public.system_sync_reward_rule_schedules();'
    );
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public.system_process_reward_domain_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.domain_events%rowtype;
  v_student_id uuid;
  v_binding record;
  v_version public.reward_rule_versions%rowtype;
  v_timezone text;
  v_state jsonb;
  v_metrics jsonb;
  v_eval jsonb;
  v_progress jsonb;
  v_evaluation_id uuid;
  v_cycle_key text;
  v_supersedes uuid;
  v_reward jsonb;
  v_reward_item jsonb;
  v_reward_key text;
  v_processed integer := 0;
  v_granted integer := 0;
  v_achievements integer := 0;
  v_is_correction boolean;
  v_program_window_start timestamptz;
  v_condition_family text;
begin
  select * into v_event
  from public.domain_events
  where event_id = p_event_id;

  if not found then
    raise exception 'domain_event_not_found';
  end if;

  v_student_id := nullif(v_event.payload->>'student_id', '')::uuid;
  if v_student_id is null then
    perform public.claim_domain_event(v_event.event_id, 'rewards.v1');
    return jsonb_build_object('processed', 0, 'reason', 'student_missing');
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = v_student_id
      and s.studio_id = v_event.studio_id
  ) then
    perform public.claim_domain_event(v_event.event_id, 'rewards.v1');
    return jsonb_build_object('processed', 0, 'reason', 'student_not_found');
  end if;

  perform public.system_materialize_reward_runtime_for_student(v_student_id);

  v_is_correction := v_event.event_type = 'attendance.corrected';

  for v_binding in
    select distinct x.rule_id, x.version_number, x.family
    from public.reward_rules_for_domain_event(v_event.event_id) x
  loop
    select * into v_version
    from public.reward_rule_versions
    where rule_id = v_binding.rule_id
      and version_number = v_binding.version_number;

    if not found then
      continue;
    end if;

    v_program_window_start :=
      private.reward_rule_program_window_start_at(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id
      );

    v_condition_family := coalesce(
      nullif(v_version.presentation_definition->>'condition_family', ''),
      case when v_binding.family = 'loyalty' then 'loyalty' else 'attendance' end
    );

    if v_condition_family not in ('attendance', 'loyalty') then
      v_condition_family := 'attendance';
    end if;

    select timezone into v_timezone
    from public.studios
    where id = v_version.studio_id;

    if v_condition_family = 'loyalty' then
      v_state := public.system_compute_reward_loyalty_state(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id,
        (v_event.occurred_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
      );

      if v_program_window_start is not null then
        v_state := private.reward_trim_loyalty_state_from(
          v_state,
          (v_program_window_start at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
        );
      end if;
    else
      v_state := public.system_compute_reward_attendance_state(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id,
        (v_event.occurred_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date,
        case
          when v_program_window_start is null then null
          else (v_program_window_start at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
        end,
        null
      );
    end if;

    v_metrics := private.reward_metrics_from_state(v_condition_family::public.reward_rule_family, v_state);
    v_eval := private.reward_evaluate_conditions(v_version.condition_definition, v_metrics);
    v_cycle_key := private.reward_cycle_key_for_event(
      v_binding.rule_id,
      v_student_id,
      v_binding.version_number,
      v_version.cycle_definition,
      v_event.occurred_at,
      v_timezone
    );

    v_supersedes := null;
    if v_is_correction then
      select e.id into v_supersedes
      from public.reward_progress_evaluations e
      join public.reward_cycles c on c.id = e.cycle_id
      where e.rule_id = v_binding.rule_id
        and e.student_id = v_student_id
        and c.cycle_key = v_cycle_key
      order by e.evaluated_at desc, e.id desc
      limit 1;
    end if;

    v_progress := public.system_record_reward_progress_evaluation(
      v_binding.rule_id,
      v_binding.version_number,
      v_student_id,
      v_cycle_key,
      'rewards:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text,
      case when v_is_correction then 'recalculation'::public.reward_progress_evaluation_kind
           else 'event'::public.reward_progress_evaluation_kind end,
      case when v_is_correction then 'recalculated'::public.reward_progress_evaluation_outcome
           else 'counted'::public.reward_progress_evaluation_outcome end,
      v_event.occurred_at,
      v_eval->'conditions',
      v_metrics,
      jsonb_build_object(
        'domain_event_id', v_event.event_id,
        'event_type', v_event.event_type,
        'source_entity_type', v_event.source_entity_type,
        'source_entity_id', v_event.source_entity_id,
        'state', v_state
      ),
      v_event.event_id,
      coalesce((v_eval->>'fulfilled')::boolean, false),
      null,
      case when v_state ? 'window_start'
        then ((v_state->>'window_start')::date)::timestamptz else null end,
      case when v_state ? 'window_end'
        then (((v_state->>'window_end')::date + 1)::timestamptz - interval '1 millisecond') else null end,
      v_supersedes
    );

    v_evaluation_id := (v_progress->>'evaluation_id')::uuid;
    v_processed := v_processed + 1;

    if v_is_correction and v_supersedes is not null then
      perform public.system_reconcile_reward_correction(v_evaluation_id);
    end if;

    if jsonb_typeof(v_version.reward_definition->'rewards') = 'array' then
      for v_reward_item in
        select value from jsonb_array_elements(v_version.reward_definition->'rewards')
      loop
        v_reward_key := coalesce(nullif(v_reward_item->>'key', ''), 'primary');

        if coalesce((v_eval->>'fulfilled')::boolean, false)
           or exists (
             select 1
             from jsonb_array_elements(v_eval->'conditions') c
             where c->>'key' = v_reward_key
               and coalesce((c->>'passed')::boolean, false)
           ) then
          if coalesce(v_reward_item->>'delivery', 'redeem') = 'achievement'
             or v_reward_item->>'kind' = 'badge' then
            if coalesce((v_eval->>'fulfilled')::boolean, false) then
              perform public.system_unlock_reward_achievement(
                v_evaluation_id,
                v_reward_key,
                coalesce(v_reward_item->>'title', v_version.name),
                v_reward_item,
                v_reward_item->>'level_key',
                'achievement:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
                v_event.occurred_at
              );
              v_achievements := v_achievements + 1;
            end if;
          else
            v_reward := public.system_generate_reward_instance(
              v_evaluation_id,
              v_reward_key,
              'reward:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
              jsonb_build_object('domain_event_id', v_event.event_id, 'event_type', v_event.event_type),
              null,
              null
            );
            if coalesce((v_reward->>'created')::boolean, false) then
              v_granted := v_granted + 1;
            end if;
          end if;
        end if;
      end loop;
    elsif jsonb_typeof(v_version.reward_definition) = 'object'
          and (
            v_version.reward_definition ? 'kind'
            or v_version.reward_definition ? 'delivery'
          ) then
      v_reward_item := v_version.reward_definition;
      v_reward_key := coalesce(nullif(v_reward_item->>'key', ''), 'primary');

      if coalesce((v_eval->>'fulfilled')::boolean, false)
         or exists (
           select 1
           from jsonb_array_elements(v_eval->'conditions') c
           where c->>'key' = v_reward_key
             and coalesce((c->>'passed')::boolean, false)
         ) then
        if coalesce(v_reward_item->>'delivery', 'redeem') = 'achievement'
           or v_reward_item->>'kind' = 'badge' then
          if coalesce((v_eval->>'fulfilled')::boolean, false) then
            perform public.system_unlock_reward_achievement(
              v_evaluation_id,
              v_reward_key,
              coalesce(v_reward_item->>'title', v_version.name),
              v_reward_item,
              v_reward_item->>'level_key',
              'achievement:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
              v_event.occurred_at
            );
            v_achievements := v_achievements + 1;
          end if;
        else
          v_reward := public.system_generate_reward_instance(
            v_evaluation_id,
            v_reward_key,
            'reward:event:' || v_event.event_id::text || ':rule:' || v_binding.rule_id::text || ':key:' || v_reward_key,
            jsonb_build_object('domain_event_id', v_event.event_id, 'event_type', v_event.event_type),
            null,
            null
          );
          if coalesce((v_reward->>'created')::boolean, false) then
            v_granted := v_granted + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;

  perform public.claim_domain_event(v_event.event_id, 'rewards.v1');

  return jsonb_build_object(
    'processed', v_processed,
    'granted', v_granted,
    'achievements', v_achievements
  );
end;
$function$
;
