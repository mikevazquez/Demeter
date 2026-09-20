-- REWARDS-01 corrective runtime wiring.
-- Closes the missing path: operational facts -> domain_events -> progress -> automatic reward.
-- Additive only: does not replace FLUJO 03, booking, sales or payment RPCs.

create or replace function private.reward_sync_rule_event_bindings(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_condition jsonb;
  v_metric text;
begin
  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found or v_rule.status <> 'active' then
    return;
  end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number;

  if not found then
    return;
  end if;

  delete from public.reward_rule_event_bindings
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number;

  for v_condition in
    select value
    from jsonb_array_elements(coalesce(v_version.condition_definition->'conditions', '[]'::jsonb))
  loop
    v_metric := trim(coalesce(v_condition->>'metric', ''));

    if v_metric like 'attendance.%' then
      insert into public.reward_rule_event_bindings(
        studio_id, rule_id, version_number, event_type, metric_key
      ) values
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'attendance.finalized', v_metric),
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'attendance.corrected', v_metric)
      on conflict (rule_id, version_number, event_type, metric_key) do nothing;
    elsif v_metric like 'loyalty.%' then
      insert into public.reward_rule_event_bindings(
        studio_id, rule_id, version_number, event_type, metric_key
      ) values
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'loyalty.changed', v_metric)
      on conflict (rule_id, version_number, event_type, metric_key) do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function private.reward_sync_rule_event_bindings(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_sync_rule_event_bindings_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.reward_sync_rule_event_bindings(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.reward_sync_rule_event_bindings_trigger()
from public, anon, authenticated, service_role;

drop trigger if exists reward_rules_sync_event_bindings on public.reward_rules;
create trigger reward_rules_sync_event_bindings
after insert or update of status, current_version_number
on public.reward_rules
for each row execute function private.reward_sync_rule_event_bindings_trigger();

create or replace function private.reward_period_step(
  p_value date,
  p_cadence text,
  p_amount integer
)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_cadence
    when 'month' then (p_value + make_interval(months => p_amount))::date
    when 'week' then (p_value + (p_amount * 7))::date
    else (p_value + p_amount)::date
  end;
$$;

revoke all on function private.reward_period_step(date,text,integer)
from public, anon, authenticated, service_role;

create or replace function private.reward_streak_from_periods(
  p_periods jsonb,
  p_as_of date,
  p_cadence text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_period date;
  v_previous date;
  v_running integer := 0;
  v_best integer := 0;
  v_latest date;
  v_current integer := 0;
  v_current_period date;
  v_previous_open date;
  v_cursor date;
begin
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' then
    return jsonb_build_object('current', 0, 'best', 0);
  end if;

  v_current_period := case p_cadence
    when 'week' then date_trunc('week', p_as_of::timestamp)::date
    when 'month' then date_trunc('month', p_as_of::timestamp)::date
    else p_as_of
  end;

  for v_period in
    select distinct value::date
    from jsonb_array_elements_text(p_periods)
    order by 1
  loop
    if v_previous is not null
       and private.reward_period_step(v_previous, p_cadence, 1) = v_period then
      v_running := v_running + 1;
    else
      v_running := 1;
    end if;

    v_best := greatest(v_best, v_running);
    if v_period <= v_current_period then
      v_latest := v_period;
    end if;
    v_previous := v_period;
  end loop;

  if v_latest is null then
    return jsonb_build_object('current', 0, 'best', v_best);
  end if;

  v_previous_open := private.reward_period_step(v_current_period, p_cadence, -1);
  if v_latest <> v_current_period and v_latest <> v_previous_open then
    return jsonb_build_object('current', 0, 'best', v_best);
  end if;

  v_cursor := v_latest;
  loop
    exit when not exists (
      select 1
      from jsonb_array_elements_text(p_periods) e(value)
      where e.value::date = v_cursor
    );
    v_current := v_current + 1;
    v_cursor := private.reward_period_step(v_cursor, p_cadence, -1);
  end loop;

  return jsonb_build_object('current', v_current, 'best', v_best);
end;
$$;

revoke all on function private.reward_streak_from_periods(jsonb,date,text)
from public, anon, authenticated, service_role;

create or replace function private.reward_metrics_from_state(
  p_family public.reward_rule_family,
  p_state jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_metrics jsonb := '{}'::jsonb;
  v_day jsonb;
  v_week jsonb;
  v_month jsonb;
  v_item record;
begin
  if p_family = 'loyalty' then
    return jsonb_build_object(
      'loyalty.current_consecutive_periods', coalesce((p_state->>'current_consecutive_periods')::integer, 0),
      'loyalty.total_paid_periods', coalesce((p_state->>'total_paid_periods')::integer, 0),
      'loyalty.best_consecutive_periods', coalesce((p_state->>'best_consecutive_periods')::integer, 0),
      'loyalty.active_coverage', coalesce((p_state->>'active_coverage')::boolean, false),
      'loyalty.in_grace', coalesce((p_state->>'in_grace')::boolean, false),
      'loyalty.effective_days_since_coverage', coalesce((p_state->>'effective_days_since_coverage')::integer, 0)
    );
  end if;

  v_day := private.reward_streak_from_periods(
    coalesce(p_state->'attended_dates', '[]'::jsonb),
    (p_state->>'as_of_date')::date,
    'day'
  );
  v_week := private.reward_streak_from_periods(
    coalesce(p_state->'attended_weeks', '[]'::jsonb),
    (p_state->>'as_of_date')::date,
    'week'
  );
  v_month := private.reward_streak_from_periods(
    coalesce(p_state->'attended_months', '[]'::jsonb),
    (p_state->>'as_of_date')::date,
    'month'
  );

  v_metrics := jsonb_build_object(
    'attendance.count', coalesce((p_state->>'counted_attendance_count')::integer, 0),
    'attendance.raw_count', coalesce((p_state->>'raw_attendance_count')::integer, 0),
    'attendance.distinct_days', coalesce((p_state->>'distinct_attendance_days')::integer, 0),
    'attendance.distinct_weeks', coalesce((p_state->>'distinct_attendance_weeks')::integer, 0),
    'attendance.distinct_months', coalesce((p_state->>'distinct_attendance_months')::integer, 0),
    'attendance.distinct_disciplines', coalesce((p_state->>'distinct_disciplines')::integer, 0),
    'attendance.no_show_count', coalesce((p_state->>'no_show_count')::integer, 0),
    'attendance.cancellation_count', coalesce((p_state->>'cancellation_count')::integer, 0),
    'attendance.streak.days.current', coalesce((v_day->>'current')::integer, 0),
    'attendance.streak.days.best', coalesce((v_day->>'best')::integer, 0),
    'attendance.streak.weeks.current', coalesce((v_week->>'current')::integer, 0),
    'attendance.streak.weeks.best', coalesce((v_week->>'best')::integer, 0),
    'attendance.streak.months.current', coalesce((v_month->>'current')::integer, 0),
    'attendance.streak.months.best', coalesce((v_month->>'best')::integer, 0)
  );

  for v_item in
    select key, value
    from jsonb_each(coalesce(p_state->'discipline_counts', '{}'::jsonb))
  loop
    v_metrics := v_metrics || jsonb_build_object(
      'attendance.discipline.' || v_item.key || '.count',
      coalesce((v_item.value->>'attendance_count')::integer, 0)
    );
  end loop;

  return v_metrics;
end;
$$;

revoke all on function private.reward_metrics_from_state(public.reward_rule_family,jsonb)
from public, anon, authenticated, service_role;

create or replace function private.reward_evaluate_conditions(
  p_definition jsonb,
  p_metrics jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_operator text := coalesce(p_definition->>'operator', 'all');
  v_condition jsonb;
  v_metric text;
  v_comparator text;
  v_target jsonb;
  v_current jsonb;
  v_missing boolean;
  v_passed boolean;
  v_results jsonb := '[]'::jsonb;
  v_fulfilled boolean;
begin
  if v_operator not in ('all', 'any') then
    raise exception 'reward_condition_operator_invalid';
  end if;

  v_fulfilled := (v_operator = 'all');

  for v_condition in
    select value
    from jsonb_array_elements(coalesce(p_definition->'conditions', '[]'::jsonb))
  loop
    v_metric := trim(coalesce(v_condition->>'metric', ''));
    v_comparator := coalesce(v_condition->>'comparator', 'gte');
    v_target := v_condition->'target';
    v_missing := not (p_metrics ? v_metric);
    v_current := case when v_missing then 'null'::jsonb else p_metrics->v_metric end;
    v_passed := false;

    if not v_missing then
      case v_comparator
        when 'eq' then v_passed := v_current = v_target;
        when 'neq' then v_passed := v_current <> v_target;
        when 'gte' then
          v_passed := jsonb_typeof(v_current) = 'number'
            and jsonb_typeof(v_target) = 'number'
            and (v_current #>> '{}')::numeric >= (v_target #>> '{}')::numeric;
        when 'gt' then
          v_passed := jsonb_typeof(v_current) = 'number'
            and jsonb_typeof(v_target) = 'number'
            and (v_current #>> '{}')::numeric > (v_target #>> '{}')::numeric;
        when 'lte' then
          v_passed := jsonb_typeof(v_current) = 'number'
            and jsonb_typeof(v_target) = 'number'
            and (v_current #>> '{}')::numeric <= (v_target #>> '{}')::numeric;
        when 'lt' then
          v_passed := jsonb_typeof(v_current) = 'number'
            and jsonb_typeof(v_target) = 'number'
            and (v_current #>> '{}')::numeric < (v_target #>> '{}')::numeric;
        else
          raise exception 'reward_condition_comparator_invalid';
      end case;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'key', coalesce(v_condition->>'key', v_metric),
      'metric', v_metric,
      'comparator', v_comparator,
      'target', v_target,
      'current', v_current,
      'passed', v_passed,
      'missing', v_missing
    ));

    if v_operator = 'all' then
      v_fulfilled := v_fulfilled and v_passed;
    else
      v_fulfilled := v_fulfilled or v_passed;
    end if;
  end loop;

  return jsonb_build_object(
    'conditions', v_results,
    'fulfilled', v_fulfilled
  );
end;
$$;

revoke all on function private.reward_evaluate_conditions(jsonb,jsonb)
from public, anon, authenticated, service_role;

create or replace function private.reward_cycle_key_for_event(
  p_rule_id uuid,
  p_student_id uuid,
  p_version_number integer,
  p_cycle_definition jsonb,
  p_occurred_at timestamptz,
  p_timezone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cadence text := coalesce(p_cycle_definition->>'cadence', 'continuous');
  v_repeatable boolean := coalesce((p_cycle_definition->>'repeatable')::boolean, false);
  v_local date := (p_occurred_at at time zone coalesce(p_timezone, 'America/Mexico_City'))::date;
  v_existing text;
  v_ordinal integer;
begin
  case v_cadence
    when 'day' then return to_char(v_local, 'YYYY-MM-DD');
    when 'week' then return 'week:' || to_char(date_trunc('week', v_local::timestamp)::date, 'YYYY-MM-DD');
    when 'month' then return 'month:' || to_char(v_local, 'YYYY-MM');
    when 'campaign' then return 'campaign:v' || p_version_number::text;
    else
      if not v_repeatable then
        return 'continuous';
      end if;

      select c.cycle_key into v_existing
      from public.reward_cycles c
      where c.rule_id = p_rule_id
        and c.student_id = p_student_id
        and c.version_number = p_version_number
        and c.status <> 'fulfilled'
      order by c.created_at desc
      limit 1;

      if v_existing is not null then
        return v_existing;
      end if;

      select count(*)::integer + 1 into v_ordinal
      from public.reward_cycles c
      where c.rule_id = p_rule_id
        and c.student_id = p_student_id
        and c.version_number = p_version_number;

      return 'continuous:' || v_ordinal::text;
  end case;
end;
$$;

revoke all on function private.reward_cycle_key_for_event(uuid,uuid,integer,jsonb,timestamptz,text)
from public, anon, authenticated, service_role;

create or replace function public.system_process_reward_domain_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

    select timezone into v_timezone
    from public.studios
    where id = v_version.studio_id;

    if v_binding.family = 'loyalty' then
      v_state := public.system_compute_reward_loyalty_state(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id,
        (v_event.occurred_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date
      );
    else
      v_state := public.system_compute_reward_attendance_state(
        v_binding.rule_id,
        v_binding.version_number,
        v_student_id,
        (v_event.occurred_at at time zone coalesce(v_timezone, 'America/Mexico_City'))::date,
        null,
        null
      );
    end if;

    v_metrics := private.reward_metrics_from_state(v_binding.family, v_state);
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
    else
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
$$;

revoke all on function public.system_process_reward_domain_event(uuid)
from public, anon, authenticated;
grant execute on function public.system_process_reward_domain_event(uuid)
to service_role;

create or replace function private.reward_try_process_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type in ('attendance.finalized', 'attendance.corrected', 'loyalty.changed') then
    begin
      perform public.system_process_reward_domain_event(new.event_id);
    exception when others then
      -- Rewards is downstream. Never fail the source operation.
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.reward_try_process_domain_event()
from public, anon, authenticated, service_role;

drop trigger if exists reward_domain_event_consumer on public.domain_events;
create trigger reward_domain_event_consumer
after insert on public.domain_events
for each row execute function private.reward_try_process_domain_event();

create or replace function private.reward_emit_attendance_finalized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation record;
begin
  if old.status is distinct from new.status and new.status = 'completed' then
    for v_reservation in
      select r.id, r.student_id, r.status
      from public.reservations r
      where r.session_id = new.id
        and r.studio_id = new.studio_id
        and r.student_id is not null
        and r.status in ('attended', 'no_show')
    loop
      perform public.emit_domain_event(
        new.studio_id,
        'attendance.finalized',
        'reservation',
        v_reservation.id,
        'rewards:attendance:finalized:' || v_reservation.id::text,
        clock_timestamp(),
        (select auth.uid()),
        jsonb_build_object(
          'student_id', v_reservation.student_id,
          'reservation_id', v_reservation.id,
          'session_id', new.id,
          'attendance_status', v_reservation.status
        ),
        null,
        null,
        null
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.reward_emit_attendance_finalized()
from public, anon, authenticated, service_role;

drop trigger if exists reward_emit_attendance_finalized on public.class_sessions;
create trigger reward_emit_attendance_finalized
after update of status on public.class_sessions
for each row execute function private.reward_emit_attendance_finalized();

create or replace function private.reward_emit_attendance_corrected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations%rowtype;
begin
  select * into v_reservation
  from public.reservations
  where id = new.reservation_id;

  if found and v_reservation.student_id is not null then
    perform public.emit_domain_event(
      new.studio_id,
      'attendance.corrected',
      'reservation',
      new.reservation_id,
      'rewards:attendance:corrected:' || new.id::text,
      new.created_at,
      new.corrected_by,
      jsonb_build_object(
        'student_id', v_reservation.student_id,
        'reservation_id', new.reservation_id,
        'session_id', v_reservation.session_id,
        'from_status', new.from_status,
        'to_status', new.to_status,
        'correction_id', new.id
      ),
      null,
      null,
      null
    );
  end if;
  return new;
end;
$$;

revoke all on function private.reward_emit_attendance_corrected()
from public, anon, authenticated, service_role;

drop trigger if exists reward_emit_attendance_corrected on public.attendance_corrections;
create trigger reward_emit_attendance_corrected
after insert on public.attendance_corrections
for each row execute function private.reward_emit_attendance_corrected();

create or replace function private.reward_emit_loyalty_acquisition_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if new.student_id is null then return new; end if;

  v_hash := md5(to_jsonb(new)::text);
  perform public.emit_domain_event(
    new.studio_id,
    'loyalty.changed',
    'product_acquisition',
    new.id,
    'rewards:loyalty:acquisition:' || new.id::text || ':' || v_hash,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', new.student_id,
      'acquisition_id', new.id,
      'status', new.status,
      'starts_on', new.starts_on,
      'expires_on', new.expires_on,
      'access_blocked', new.access_blocked,
      'refunded_at', new.refunded_at
    ),
    null,
    null,
    null
  );
  return new;
end;
$$;

revoke all on function private.reward_emit_loyalty_acquisition_changed()
from public, anon, authenticated, service_role;

drop trigger if exists reward_emit_loyalty_acquisition_inserted on public.product_acquisitions;
create trigger reward_emit_loyalty_acquisition_inserted
after insert on public.product_acquisitions
for each row execute function private.reward_emit_loyalty_acquisition_changed();

drop trigger if exists reward_emit_loyalty_acquisition_updated on public.product_acquisitions;
create trigger reward_emit_loyalty_acquisition_updated
after update of status, starts_on, expires_on, access_blocked, refunded_at, sale_line_id
on public.product_acquisitions
for each row
when (old is distinct from new)
execute function private.reward_emit_loyalty_acquisition_changed();

create or replace function private.reward_emit_loyalty_payment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  select s.student_id into v_student_id
  from public.sales s
  where s.id = new.sale_id
    and s.studio_id = new.studio_id;

  if v_student_id is null then return new; end if;

  perform public.emit_domain_event(
    new.studio_id,
    'loyalty.changed',
    'payment',
    new.id,
    'rewards:loyalty:payment:' || new.id::text || ':' || md5(to_jsonb(new)::text),
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', v_student_id,
      'payment_id', new.id,
      'sale_id', new.sale_id,
      'kind', new.kind,
      'amount_minor', new.amount_minor,
      'effective_on', new.effective_on
    ),
    null,
    null,
    null
  );
  return new;
end;
$$;

revoke all on function private.reward_emit_loyalty_payment_changed()
from public, anon, authenticated, service_role;

drop trigger if exists reward_emit_loyalty_payment_inserted on public.payments;
create trigger reward_emit_loyalty_payment_inserted
after insert on public.payments
for each row execute function private.reward_emit_loyalty_payment_changed();

drop trigger if exists reward_emit_loyalty_payment_updated on public.payments;
create trigger reward_emit_loyalty_payment_updated
after update of kind, amount_minor, sale_line_id, effective_on
on public.payments
for each row
when (old is distinct from new)
execute function private.reward_emit_loyalty_payment_changed();

-- Backfill bindings for rules that were already active before this corrective migration.
do $$
declare
  v_rule record;
begin
  for v_rule in
    select id from public.reward_rules where status = 'active'
  loop
    perform private.reward_sync_rule_event_bindings(v_rule.id);
  end loop;
end
$$;
