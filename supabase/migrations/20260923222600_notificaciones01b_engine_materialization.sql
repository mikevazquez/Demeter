-- NOTIFICACIONES-01B · Atomic materialization and rule read contracts.

create or replace function public.system_materialize_notification(
  p_studio_id uuid,
  p_source_event_id uuid,
  p_rule_id uuid,
  p_rule_version_number integer,
  p_notification_type text,
  p_recipient_type text,
  p_recipient_entity_id uuid,
  p_recipient_user_id uuid,
  p_recipient_snapshot jsonb,
  p_priority text,
  p_scheduled_for timestamptz,
  p_expires_at timestamptz,
  p_template_key text,
  p_template_variables jsonb,
  p_deduplication_key text,
  p_channels jsonb,
  p_suppressed boolean default false,
  p_reason_code text default null,
  p_reason_detail text default null
)
returns table (
  notification_id uuid,
  created boolean,
  jobs_created integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notification_id uuid;
  v_created boolean := false;
  v_jobs_created integer := 0;
  v_initial_state text;
  v_channel jsonb;
  v_channel_key text;
  v_is_required boolean;
  v_max_attempts integer;
  v_scheduled_at timestamptz;
begin
  if p_recipient_snapshot is null or jsonb_typeof(p_recipient_snapshot) <> 'object' then
    raise exception 'notification_recipient_snapshot_must_be_object';
  end if;
  if p_template_variables is null or jsonb_typeof(p_template_variables) <> 'object' then
    raise exception 'notification_template_variables_must_be_object';
  end if;
  if p_channels is null or jsonb_typeof(p_channels) <> 'array' then
    raise exception 'notification_channels_must_be_array';
  end if;
  if not coalesce(p_suppressed, false) and jsonb_array_length(p_channels) = 0 then
    raise exception 'notification_channels_required';
  end if;

  v_initial_state := case
    when coalesce(p_suppressed, false) then 'suppressed'
    when p_scheduled_for is not null and p_scheduled_for > clock_timestamp() then 'scheduled'
    else 'pending'
  end;

  insert into public.notifications (
    studio_id, source_event_id, rule_id, rule_version_number,
    notification_type, recipient_type, recipient_entity_id, recipient_user_id,
    recipient_snapshot, priority, state, scheduled_for, expires_at,
    template_key, template_variables, deduplication_key,
    state_reason_code, state_reason_detail, state_actor_type, suppressed_at
  ) values (
    p_studio_id, p_source_event_id, p_rule_id, p_rule_version_number,
    trim(p_notification_type), trim(p_recipient_type), p_recipient_entity_id, p_recipient_user_id,
    p_recipient_snapshot, p_priority, v_initial_state, p_scheduled_for, p_expires_at,
    trim(p_template_key), p_template_variables, trim(p_deduplication_key),
    case
      when coalesce(p_suppressed, false)
        then coalesce(nullif(trim(coalesce(p_reason_code, '')), ''), 'suppressed')
      else 'created'
    end,
    nullif(left(trim(coalesce(p_reason_detail, '')), 1000), ''),
    'system',
    case when coalesce(p_suppressed, false) then clock_timestamp() else null end
  )
  on conflict (studio_id, deduplication_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select n.id
      into v_notification_id
    from public.notifications n
    where n.studio_id = p_studio_id
      and n.deduplication_key = trim(p_deduplication_key);

    return query select v_notification_id, false, 0;
    return;
  end if;

  v_created := true;

  if not coalesce(p_suppressed, false) then
    for v_channel in
      select value
      from jsonb_array_elements(p_channels)
    loop
      v_channel_key := nullif(trim(coalesce(v_channel->>'channel_key', '')), '');
      if v_channel_key is null then
        raise exception 'notification_channel_key_required';
      end if;

      if not exists (
        select 1
        from public.notification_channels c
        where c.channel_key = v_channel_key
          and c.is_active
      ) then
        raise exception 'notification_channel_inactive:%', v_channel_key;
      end if;

      v_is_required := coalesce((v_channel->>'is_required')::boolean, true);
      v_max_attempts := greatest(
        1,
        least(
          10,
          coalesce(nullif(v_channel#>>'{channel_policy,max_attempts}', '')::integer, 3)
        )
      );

      v_scheduled_at := coalesce(p_scheduled_for, clock_timestamp());

      insert into public.notification_jobs (
        studio_id, notification_id, channel_key, is_required, state,
        scheduled_at, available_at, expires_at, max_attempts,
        channel_deduplication_key, state_reason_code, state_actor_type
      ) values (
        p_studio_id, v_notification_id, v_channel_key, v_is_required,
        case when v_scheduled_at > clock_timestamp() then 'scheduled' else 'pending' end,
        v_scheduled_at, v_scheduled_at, p_expires_at, v_max_attempts,
        v_notification_id::text || ':' || v_channel_key, 'created', 'system'
      );

      v_jobs_created := v_jobs_created + 1;
    end loop;
  end if;

  return query select v_notification_id, v_created, v_jobs_created;
end;
$$;

revoke all on function public.system_materialize_notification(
  uuid,uuid,uuid,integer,text,text,uuid,uuid,jsonb,text,timestamptz,timestamptz,text,jsonb,text,jsonb,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.system_materialize_notification(
  uuid,uuid,uuid,integer,text,text,uuid,uuid,jsonb,text,timestamptz,timestamptz,text,jsonb,text,jsonb,boolean,text,text
) to service_role;

create or replace function public.system_record_notification_rule_evaluation(
  p_studio_id uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_version_number integer,
  p_outcome text,
  p_reason_code text default null,
  p_details jsonb default '{}'::jsonb,
  p_recipient_count integer default 0,
  p_notifications_created integer default 0
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'notification_rule_evaluation_details_must_be_object';
  end if;

  insert into public.notification_rule_evaluations (
    studio_id, event_id, rule_id, rule_version_number, outcome, reason_code,
    details, recipient_count, notifications_created, evaluated_at
  ) values (
    p_studio_id, p_event_id, p_rule_id, p_rule_version_number, p_outcome,
    nullif(trim(coalesce(p_reason_code, '')), ''), p_details,
    greatest(coalesce(p_recipient_count, 0), 0),
    greatest(coalesce(p_notifications_created, 0), 0),
    clock_timestamp()
  )
  on conflict (event_id, rule_id, rule_version_number)
  do update set
    outcome = excluded.outcome,
    reason_code = excluded.reason_code,
    details = excluded.details,
    recipient_count = excluded.recipient_count,
    notifications_created = excluded.notifications_created,
    evaluated_at = clock_timestamp()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.system_record_notification_rule_evaluation(
  uuid,uuid,uuid,integer,text,text,jsonb,integer,integer
) from public, anon, authenticated;
grant execute on function public.system_record_notification_rule_evaluation(
  uuid,uuid,uuid,integer,text,text,jsonb,integer,integer
) to service_role;

create or replace function public.system_cancel_pending_notifications_for_source(
  p_studio_id uuid,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_reason_code text,
  p_reason_detail text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with targets as (
    select j.id
    from public.notification_jobs j
    join public.notifications n
      on n.id = j.notification_id
     and n.studio_id = j.studio_id
    join public.domain_events e
      on e.event_id = n.source_event_id
     and e.studio_id = n.studio_id
    where j.studio_id = p_studio_id
      and e.source_entity_type = trim(p_source_entity_type)
      and e.source_entity_id = p_source_entity_id
      and j.state in ('pending','scheduled','retrying')
    for update of j
  )
  update public.notification_jobs j
  set
    state = 'cancelled',
    state_reason_code = coalesce(nullif(trim(coalesce(p_reason_code, '')), ''), 'source_invalidated'),
    state_reason_detail = nullif(left(trim(coalesce(p_reason_detail, '')), 1000), ''),
    state_actor_type = 'system',
    state_actor_id = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    next_attempt_at = null,
    completed_at = coalesce(j.completed_at, clock_timestamp())
  from targets t
  where j.id = t.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.system_cancel_pending_notifications_for_source(uuid,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.system_cancel_pending_notifications_for_source(uuid,text,uuid,text,text)
to service_role;

create or replace function public.service_get_notification_rules_for_event(
  p_studio_id uuid,
  p_event_type text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rule_id', r.id,
        'rule_key', r.rule_key,
        'event_type', r.event_type,
        'version_number', v.version_number,
        'notification_type', v.notification_type,
        'priority', v.priority,
        'recipient_strategy_key', v.recipient_strategy_key,
        'conditions', v.conditions,
        'timing_strategy_key', v.timing_strategy_key,
        'timing_config', v.timing_config,
        'revalidation_strategy_key', v.revalidation_strategy_key,
        'template_key', v.template_key,
        'expires_after_seconds', v.expires_after_seconds,
        'channels', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'channel_key', c.channel_key,
              'is_required', rc.is_required,
              'ordinal', rc.ordinal,
              'channel_policy', rc.channel_policy
            )
            order by rc.ordinal, rc.channel_key
          )
          from public.notification_rule_channels rc
          join public.notification_channels c
            on c.channel_key = rc.channel_key
           and c.is_active
          where rc.studio_id = r.studio_id
            and rc.rule_id = r.id
            and rc.version_number = v.version_number
        ), '[]'::jsonb)
      )
      order by r.rule_key
    ),
    '[]'::jsonb
  )
  from public.notification_rules r
  join public.notification_rule_versions v
    on v.studio_id = r.studio_id
   and v.rule_id = r.id
   and v.version_number = r.current_version_number
  where r.studio_id = p_studio_id
    and r.event_type = trim(p_event_type)
    and r.enabled
    and r.archived_at is null
    and v.activated_at is not null;
$$;

revoke all on function public.service_get_notification_rules_for_event(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_get_notification_rules_for_event(uuid,text)
to service_role;
