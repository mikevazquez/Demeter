-- NOTIFICACIONES-01B · Contact Governor runtime.
-- Applies P0/P1/P2 frequency, collision and pre-delivery revalidation policies.

create or replace function private.evaluate_notification_contact(
  p_studio_id uuid,
  p_recipient_type text,
  p_recipient_entity_id uuid,
  p_recipient_user_id uuid,
  p_communication_class text,
  p_scheduled_for timestamptz,
  p_expires_at timestamptz,
  p_exclude_notification_id uuid default null
)
returns table (
  outcome text,
  effective_scheduled_for timestamptz,
  reason_code text,
  policy_snapshot jsonb
)
language plpgsql
set search_path = ''
as $$
declare
  v_policy public.notification_contact_policies%rowtype;
  v_effective timestamptz := p_scheduled_for;
  v_higher_at timestamptz;
  v_last_same_class timestamptz;
  v_count_24h integer := 0;
  v_count_7d integer := 0;
  v_defer_reason text;
  v_snapshot jsonb;
begin
  if p_communication_class not in ('P0','P1','P2') then
    raise exception 'notification_communication_class_invalid';
  end if;

  if p_scheduled_for is null then
    raise exception 'notification_contact_scheduled_for_required';
  end if;

  if p_recipient_user_id is null and p_recipient_entity_id is null then
    raise exception 'notification_contact_recipient_identity_required';
  end if;

  select *
    into v_policy
  from public.notification_contact_policies p
  where p.studio_id = p_studio_id
    and p.communication_class = p_communication_class;

  if not found then
    raise exception 'notification_contact_policy_missing:%', p_communication_class;
  end if;

  v_snapshot := jsonb_build_object(
    'communication_class', v_policy.communication_class,
    'cooldown_seconds', v_policy.cooldown_seconds,
    'max_per_24h', v_policy.max_per_24h,
    'max_per_7d', v_policy.max_per_7d,
    'collision_window_before_seconds', v_policy.collision_window_before_seconds,
    'collision_window_after_seconds', v_policy.collision_window_after_seconds,
    'on_higher_class_collision', v_policy.on_higher_class_collision,
    'defer_seconds', v_policy.defer_seconds,
    'respect_quiet_hours', v_policy.respect_quiet_hours,
    'respect_marketing_preferences', v_policy.respect_marketing_preferences,
    'enabled', v_policy.enabled
  );

  if not v_policy.enabled then
    return query select 'allow', v_effective, 'governor_disabled', v_snapshot;
    return;
  end if;

  if p_communication_class = 'P0' then
    return query select 'allow', v_effective, 'p0_operational', v_snapshot;
    return;
  end if;

  if v_policy.on_higher_class_collision <> 'allow'
     and (
       v_policy.collision_window_before_seconds > 0
       or v_policy.collision_window_after_seconds > 0
     ) then
    select max(coalesce(n.scheduled_for, n.created_at))
      into v_higher_at
    from public.notifications n
    where n.studio_id = p_studio_id
      and (p_exclude_notification_id is null or n.id <> p_exclude_notification_id)
      and n.state not in ('suppressed','cancelled','failed')
      and private.notification_class_rank(n.communication_class)
          < private.notification_class_rank(p_communication_class)
      and (
        (p_recipient_user_id is not null and n.recipient_user_id = p_recipient_user_id)
        or (
          p_recipient_entity_id is not null
          and n.recipient_type = p_recipient_type
          and n.recipient_entity_id = p_recipient_entity_id
        )
      )
      and coalesce(n.scheduled_for, n.created_at)
          between p_scheduled_for - make_interval(secs => v_policy.collision_window_before_seconds)
              and p_scheduled_for + make_interval(secs => v_policy.collision_window_after_seconds);

    if v_higher_at is not null then
      if v_policy.on_higher_class_collision = 'suppress' then
        return query
        select 'suppress', null::timestamptz, 'higher_class_notification_nearby', v_snapshot;
        return;
      end if;

      if v_policy.on_higher_class_collision = 'defer' then
        v_effective := greatest(
          p_scheduled_for + make_interval(secs => v_policy.defer_seconds),
          v_higher_at + make_interval(secs => v_policy.collision_window_after_seconds)
        );
        v_defer_reason := 'higher_class_notification_nearby';

        if p_expires_at is not null and v_effective >= p_expires_at then
          return query
          select 'suppress', null::timestamptz, 'defer_would_expire', v_snapshot;
          return;
        end if;
      end if;
    end if;
  end if;

  if v_policy.max_per_7d is not null then
    select count(*)::integer
      into v_count_7d
    from public.notifications n
    where n.studio_id = p_studio_id
      and (p_exclude_notification_id is null or n.id <> p_exclude_notification_id)
      and n.communication_class = p_communication_class
      and n.state not in ('suppressed','cancelled','failed')
      and (
        (p_recipient_user_id is not null and n.recipient_user_id = p_recipient_user_id)
        or (
          p_recipient_entity_id is not null
          and n.recipient_type = p_recipient_type
          and n.recipient_entity_id = p_recipient_entity_id
        )
      )
      and coalesce(n.scheduled_for, n.created_at) < v_effective
      and coalesce(n.scheduled_for, n.created_at) >= v_effective - interval '7 days';

    if v_count_7d >= v_policy.max_per_7d then
      return query
      select 'suppress', null::timestamptz, 'weekly_frequency_cap', v_snapshot;
      return;
    end if;
  end if;

  if v_policy.max_per_24h is not null then
    select count(*)::integer
      into v_count_24h
    from public.notifications n
    where n.studio_id = p_studio_id
      and (p_exclude_notification_id is null or n.id <> p_exclude_notification_id)
      and n.communication_class = p_communication_class
      and n.state not in ('suppressed','cancelled','failed')
      and (
        (p_recipient_user_id is not null and n.recipient_user_id = p_recipient_user_id)
        or (
          p_recipient_entity_id is not null
          and n.recipient_type = p_recipient_type
          and n.recipient_entity_id = p_recipient_entity_id
        )
      )
      and coalesce(n.scheduled_for, n.created_at) < v_effective
      and coalesce(n.scheduled_for, n.created_at) >= v_effective - interval '24 hours';

    if v_count_24h >= v_policy.max_per_24h then
      return query
      select 'suppress', null::timestamptz, 'daily_frequency_cap', v_snapshot;
      return;
    end if;
  end if;

  if v_policy.cooldown_seconds > 0 then
    select max(coalesce(n.scheduled_for, n.created_at))
      into v_last_same_class
    from public.notifications n
    where n.studio_id = p_studio_id
      and (p_exclude_notification_id is null or n.id <> p_exclude_notification_id)
      and n.communication_class = p_communication_class
      and n.state not in ('suppressed','cancelled','failed')
      and (
        (p_recipient_user_id is not null and n.recipient_user_id = p_recipient_user_id)
        or (
          p_recipient_entity_id is not null
          and n.recipient_type = p_recipient_type
          and n.recipient_entity_id = p_recipient_entity_id
        )
      )
      and coalesce(n.scheduled_for, n.created_at) < v_effective
      and coalesce(n.scheduled_for, n.created_at)
          >= v_effective - make_interval(secs => v_policy.cooldown_seconds);

    if v_last_same_class is not null then
      v_effective := greatest(
        v_effective,
        v_last_same_class + make_interval(secs => v_policy.cooldown_seconds)
      );
      v_defer_reason := coalesce(v_defer_reason, 'class_cooldown');

      if p_expires_at is not null and v_effective >= p_expires_at then
        return query
        select 'suppress', null::timestamptz, 'cooldown_would_expire', v_snapshot;
        return;
      end if;
    end if;
  end if;

  if v_defer_reason is not null and v_effective > p_scheduled_for then
    return query select 'defer', v_effective, v_defer_reason, v_snapshot;
    return;
  end if;

  return query select 'allow', v_effective, 'policy_allow', v_snapshot;
end;
$$;

revoke all on function private.evaluate_notification_contact(
  uuid,text,uuid,uuid,text,timestamptz,timestamptz,uuid
) from public, anon, authenticated;

create or replace function public.system_evaluate_notification_contact_candidate(
  p_studio_id uuid,
  p_source_event_id uuid,
  p_rule_id uuid,
  p_rule_version_number integer,
  p_recipient_type text,
  p_recipient_entity_id uuid,
  p_recipient_user_id uuid,
  p_communication_class text,
  p_scheduled_for timestamptz,
  p_expires_at timestamptz
)
returns table (
  outcome text,
  effective_scheduled_for timestamptz,
  reason_code text,
  policy_snapshot jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result record;
begin
  select *
    into v_result
  from private.evaluate_notification_contact(
    p_studio_id,
    p_recipient_type,
    p_recipient_entity_id,
    p_recipient_user_id,
    p_communication_class,
    p_scheduled_for,
    p_expires_at,
    null
  );

  insert into public.notification_contact_decisions (
    studio_id,
    source_event_id,
    rule_id,
    rule_version_number,
    notification_id,
    recipient_type,
    recipient_entity_id,
    recipient_user_id,
    communication_class,
    phase,
    outcome,
    reason_code,
    original_scheduled_for,
    effective_scheduled_for,
    policy_snapshot
  ) values (
    p_studio_id,
    p_source_event_id,
    p_rule_id,
    p_rule_version_number,
    null,
    trim(p_recipient_type),
    p_recipient_entity_id,
    p_recipient_user_id,
    p_communication_class,
    'materialization',
    v_result.outcome,
    v_result.reason_code,
    p_scheduled_for,
    v_result.effective_scheduled_for,
    v_result.policy_snapshot
  );

  return query
  select
    v_result.outcome::text,
    v_result.effective_scheduled_for::timestamptz,
    v_result.reason_code::text,
    v_result.policy_snapshot::jsonb;
end;
$$;

revoke all on function public.system_evaluate_notification_contact_candidate(
  uuid,uuid,uuid,integer,text,uuid,uuid,text,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.system_evaluate_notification_contact_candidate(
  uuid,uuid,uuid,integer,text,uuid,uuid,text,timestamptz,timestamptz
) to service_role;

create or replace function public.system_revalidate_notification_contact(
  p_notification_id uuid
)
returns table (
  outcome text,
  effective_scheduled_for timestamptz,
  reason_code text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_result record;
begin
  select *
    into v_notification
  from public.notifications n
  where n.id = p_notification_id
  for update;

  if not found then
    raise exception 'notification_not_found';
  end if;

  if v_notification.state in ('cancelled','suppressed','failed','completed') then
    return query
    select
      'suppress'::text,
      null::timestamptz,
      ('notification_' || v_notification.state)::text;
    return;
  end if;

  select *
    into v_result
  from private.evaluate_notification_contact(
    v_notification.studio_id,
    v_notification.recipient_type,
    v_notification.recipient_entity_id,
    v_notification.recipient_user_id,
    v_notification.communication_class,
    coalesce(v_notification.scheduled_for, clock_timestamp()),
    v_notification.expires_at,
    v_notification.id
  );

  insert into public.notification_contact_decisions (
    studio_id,
    source_event_id,
    rule_id,
    rule_version_number,
    notification_id,
    recipient_type,
    recipient_entity_id,
    recipient_user_id,
    communication_class,
    phase,
    outcome,
    reason_code,
    original_scheduled_for,
    effective_scheduled_for,
    policy_snapshot
  ) values (
    v_notification.studio_id,
    v_notification.source_event_id,
    v_notification.rule_id,
    v_notification.rule_version_number,
    v_notification.id,
    v_notification.recipient_type,
    v_notification.recipient_entity_id,
    v_notification.recipient_user_id,
    v_notification.communication_class,
    'pre_delivery',
    v_result.outcome,
    v_result.reason_code,
    coalesce(v_notification.scheduled_for, clock_timestamp()),
    v_result.effective_scheduled_for,
    v_result.policy_snapshot
  );

  if v_result.outcome = 'suppress' then
    update public.notifications
    set
      state = 'suppressed',
      state_reason_code = v_result.reason_code,
      state_reason_detail = 'Contact governor suppressed delivery.',
      state_actor_type = 'system',
      state_actor_id = null,
      suppressed_at = coalesce(suppressed_at, clock_timestamp())
    where id = v_notification.id;

    update public.notification_jobs
    set
      state = 'suppressed',
      state_reason_code = v_result.reason_code,
      state_reason_detail = 'Contact governor suppressed delivery.',
      state_actor_type = 'system',
      state_actor_id = null,
      lease_owner = null,
      lease_acquired_at = null,
      lease_expires_at = null,
      next_attempt_at = null,
      completed_at = coalesce(completed_at, clock_timestamp())
    where notification_id = v_notification.id
      and state in ('pending','scheduled','retrying');

  elsif v_result.outcome = 'defer' then
    update public.notifications
    set
      state = 'scheduled',
      scheduled_for = v_result.effective_scheduled_for,
      state_reason_code = v_result.reason_code,
      state_reason_detail = 'Contact governor deferred delivery.',
      state_actor_type = 'system',
      state_actor_id = null
    where id = v_notification.id;

    update public.notification_jobs
    set
      state = 'scheduled',
      scheduled_at = v_result.effective_scheduled_for,
      available_at = v_result.effective_scheduled_for,
      next_attempt_at = null,
      state_reason_code = v_result.reason_code,
      state_reason_detail = 'Contact governor deferred delivery.',
      state_actor_type = 'system',
      state_actor_id = null,
      lease_owner = null,
      lease_acquired_at = null,
      lease_expires_at = null
    where notification_id = v_notification.id
      and state in ('pending','scheduled','retrying');
  end if;

  return query
  select
    v_result.outcome::text,
    v_result.effective_scheduled_for::timestamptz,
    v_result.reason_code::text;
end;
$$;

revoke all on function public.system_revalidate_notification_contact(uuid)
from public, anon, authenticated;
grant execute on function public.system_revalidate_notification_contact(uuid)
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
        'communication_class', v.communication_class,
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

create or replace function public.system_materialize_notification(
  p_studio_id uuid,
  p_source_event_id uuid,
  p_rule_id uuid,
  p_rule_version_number integer,
  p_notification_type text,
  p_communication_class text,
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
  if p_communication_class not in ('P0','P1','P2') then
    raise exception 'notification_communication_class_invalid';
  end if;

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
    studio_id,
    source_event_id,
    rule_id,
    rule_version_number,
    notification_type,
    communication_class,
    recipient_type,
    recipient_entity_id,
    recipient_user_id,
    recipient_snapshot,
    priority,
    state,
    scheduled_for,
    expires_at,
    template_key,
    template_variables,
    deduplication_key,
    state_reason_code,
    state_reason_detail,
    state_actor_type,
    suppressed_at
  ) values (
    p_studio_id,
    p_source_event_id,
    p_rule_id,
    p_rule_version_number,
    trim(p_notification_type),
    p_communication_class,
    trim(p_recipient_type),
    p_recipient_entity_id,
    p_recipient_user_id,
    p_recipient_snapshot,
    p_priority,
    v_initial_state,
    p_scheduled_for,
    p_expires_at,
    trim(p_template_key),
    p_template_variables,
    trim(p_deduplication_key),
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
        studio_id,
        notification_id,
        channel_key,
        is_required,
        state,
        scheduled_at,
        available_at,
        expires_at,
        max_attempts,
        channel_deduplication_key,
        state_reason_code,
        state_actor_type
      ) values (
        p_studio_id,
        v_notification_id,
        v_channel_key,
        v_is_required,
        case when v_scheduled_at > clock_timestamp() then 'scheduled' else 'pending' end,
        v_scheduled_at,
        v_scheduled_at,
        p_expires_at,
        v_max_attempts,
        v_notification_id::text || ':' || v_channel_key,
        'created',
        'system'
      );

      v_jobs_created := v_jobs_created + 1;
    end loop;
  end if;

  return query select v_notification_id, v_created, v_jobs_created;
end;
$$;

revoke all on function public.system_materialize_notification(
  uuid,uuid,uuid,integer,text,text,text,uuid,uuid,jsonb,text,timestamptz,timestamptz,text,jsonb,text,jsonb,boolean,text,text
) from public, anon, authenticated;
grant execute on function public.system_materialize_notification(
  uuid,uuid,uuid,integer,text,text,text,uuid,uuid,jsonb,text,timestamptz,timestamptz,text,jsonb,text,jsonb,boolean,text,text
) to service_role;

create or replace function public.system_claim_notification_jobs(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,
  studio_id uuid,
  notification_id uuid,
  channel_key text,
  is_required boolean,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notification_id uuid;
begin
  if trim(coalesce(p_worker_id, '')) = '' then
    raise exception 'notification_worker_id_required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'notification_claim_limit_invalid';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'notification_lease_invalid';
  end if;

  update public.notification_jobs j
  set
    state = 'expired',
    state_reason_code = 'delivery_window_elapsed',
    state_reason_detail = null,
    state_actor_type = 'system',
    state_actor_id = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    completed_at = coalesce(j.completed_at, clock_timestamp())
  where j.state in ('pending','scheduled','retrying')
    and j.expires_at is not null
    and j.expires_at <= clock_timestamp();

  for v_notification_id in
    select distinct j.notification_id
    from public.notification_jobs j
    where j.attempt_count < j.max_attempts
      and (j.expires_at is null or j.expires_at > clock_timestamp())
      and (
        (
          j.state = 'pending'
          and j.available_at <= clock_timestamp()
        )
        or (
          j.state = 'scheduled'
          and j.scheduled_at <= clock_timestamp()
          and j.available_at <= clock_timestamp()
        )
        or (
          j.state = 'retrying'
          and coalesce(j.next_attempt_at, j.available_at) <= clock_timestamp()
        )
        or (
          j.state = 'processing'
          and j.lease_expires_at is not null
          and j.lease_expires_at <= clock_timestamp()
        )
      )
    order by j.notification_id
    limit least(p_limit * 2, 400)
  loop
    perform public.system_revalidate_notification_contact(v_notification_id);
  end loop;

  return query
  with candidates as (
    select j.id
    from public.notification_jobs j
    where j.attempt_count < j.max_attempts
      and (j.expires_at is null or j.expires_at > clock_timestamp())
      and (
        (
          j.state = 'pending'
          and j.available_at <= clock_timestamp()
        )
        or (
          j.state = 'scheduled'
          and j.scheduled_at <= clock_timestamp()
          and j.available_at <= clock_timestamp()
        )
        or (
          j.state = 'retrying'
          and coalesce(j.next_attempt_at, j.available_at) <= clock_timestamp()
        )
        or (
          j.state = 'processing'
          and j.lease_expires_at is not null
          and j.lease_expires_at <= clock_timestamp()
        )
      )
    order by coalesce(j.next_attempt_at, j.scheduled_at, j.available_at), j.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_jobs j
    set
      state = 'processing',
      state_reason_code = 'worker_claimed',
      state_reason_detail = null,
      state_actor_type = 'system',
      state_actor_id = null,
      lease_owner = trim(p_worker_id),
      lease_acquired_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    from candidates c
    where j.id = c.id
    returning
      j.id,
      j.studio_id,
      j.notification_id,
      j.channel_key,
      j.is_required,
      j.attempt_count,
      j.max_attempts
  )
  select
    c.id,
    c.studio_id,
    c.notification_id,
    c.channel_key,
    c.is_required,
    c.attempt_count,
    c.max_attempts
  from claimed c;
end;
$$;

revoke all on function public.system_claim_notification_jobs(text,integer,integer)
from public, anon, authenticated;
grant execute on function public.system_claim_notification_jobs(text,integer,integer)
to service_role;
