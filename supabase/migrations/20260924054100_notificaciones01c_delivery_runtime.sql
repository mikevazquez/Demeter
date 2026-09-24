-- NOTIFICACIONES-01C · Delivery runtime and provider-attempt lifecycle.

create or replace function public.system_accept_notification_delivery_handoff(
  p_job_id uuid,
  p_worker_id text
)
returns table (
  delivery_id uuid,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.notification_jobs%rowtype;
  v_notification public.notifications%rowtype;
  v_adapter public.notification_channel_adapters%rowtype;
  v_existing_id uuid;
  v_delivery_id uuid;
  v_channel_policy jsonb := '{}'::jsonb;
  v_delivery_max_attempts integer := 3;
  v_handed_off boolean;
begin
  select d.id
    into v_existing_id
  from public.notification_deliveries d
  where d.job_id = p_job_id;

  if v_existing_id is not null then
    return query select v_existing_id, false;
    return;
  end if;

  select *
    into v_job
  from public.notification_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception 'notification_job_not_found';
  end if;

  if v_job.state <> 'processing'
     or v_job.lease_owner is distinct from trim(coalesce(p_worker_id, ''))
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= clock_timestamp() then
    raise exception 'notification_job_handoff_lease_invalid';
  end if;

  select *
    into v_notification
  from public.notifications n
  where n.id = v_job.notification_id
    and n.studio_id = v_job.studio_id;

  if not found then
    raise exception 'notification_not_found';
  end if;

  select *
    into v_adapter
  from public.notification_channel_adapters a
  where a.channel_key = v_job.channel_key;

  if not found then
    raise exception 'notification_channel_adapter_missing';
  end if;

  select coalesce(rc.channel_policy, '{}'::jsonb)
    into v_channel_policy
  from public.notification_rule_channels rc
  where rc.studio_id = v_notification.studio_id
    and rc.rule_id = v_notification.rule_id
    and rc.version_number = v_notification.rule_version_number
    and rc.channel_key = v_job.channel_key;

  v_channel_policy := coalesce(v_channel_policy, '{}'::jsonb);

  begin
    v_delivery_max_attempts :=
      greatest(
        1,
        least(
          10,
          coalesce(
            nullif(v_channel_policy->>'delivery_max_attempts', '')::integer,
            3
          )
        )
      );
  exception when others then
    raise exception 'notification_delivery_max_attempts_invalid';
  end;

  insert into public.notification_deliveries (
    studio_id,
    job_id,
    notification_id,
    source_event_id,
    channel_key,
    adapter_key,
    adapter_enabled,
    provider_key,
    notification_type,
    communication_class,
    priority,
    recipient_type,
    recipient_entity_id,
    recipient_user_id,
    recipient_snapshot,
    template_key,
    template_variables,
    channel_policy,
    state,
    attempt_count,
    max_attempts,
    available_at,
    expires_at,
    handed_off_at
  ) values (
    v_notification.studio_id,
    v_job.id,
    v_notification.id,
    v_notification.source_event_id,
    v_job.channel_key,
    v_adapter.adapter_key,
    v_adapter.enabled,
    v_adapter.provider_key,
    v_notification.notification_type,
    v_notification.communication_class,
    v_notification.priority,
    v_notification.recipient_type,
    v_notification.recipient_entity_id,
    v_notification.recipient_user_id,
    v_notification.recipient_snapshot,
    v_notification.template_key,
    v_notification.template_variables,
    v_channel_policy,
    'pending',
    0,
    v_delivery_max_attempts,
    clock_timestamp(),
    v_job.expires_at,
    clock_timestamp()
  )
  on conflict (job_id) do nothing
  returning id into v_delivery_id;

  if v_delivery_id is null then
    select d.id
      into v_delivery_id
    from public.notification_deliveries d
    where d.job_id = v_job.id;

    return query select v_delivery_id, false;
    return;
  end if;

  select public.system_mark_notification_job_handed_off(
    v_job.id,
    p_worker_id
  ) into v_handed_off;

  if v_handed_off is distinct from true then
    raise exception 'notification_job_handoff_commit_failed';
  end if;

  return query select v_delivery_id, true;
end;
$$;

create or replace function public.system_claim_notification_deliveries(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns table (
  delivery_id uuid,
  studio_id uuid,
  job_id uuid,
  notification_id uuid,
  channel_key text,
  adapter_key text,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if trim(coalesce(p_worker_id, '')) = '' then
    raise exception 'notification_delivery_worker_id_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'notification_delivery_claim_limit_invalid';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'notification_delivery_lease_invalid';
  end if;

  update public.notification_deliveries d
  set
    state = 'expired',
    next_attempt_at = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = 'delivery_window',
    last_error_code = 'delivery_window_elapsed',
    last_error_safe = null,
    completed_at = coalesce(d.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where d.expires_at is not null
    and d.expires_at <= clock_timestamp()
    and (
      d.state in ('pending','retry_wait')
      or (
        d.state = 'processing'
        and d.lease_expires_at is not null
        and d.lease_expires_at <= clock_timestamp()
      )
    );

  return query
  with candidates as (
    select d.id
    from public.notification_deliveries d
    where d.attempt_count < d.max_attempts
      and (d.expires_at is null or d.expires_at > clock_timestamp())
      and (
        (d.state = 'pending' and d.available_at <= clock_timestamp())
        or (
          d.state = 'retry_wait'
          and coalesce(d.next_attempt_at, d.available_at) <= clock_timestamp()
        )
        or (
          d.state = 'processing'
          and d.lease_expires_at is not null
          and d.lease_expires_at <= clock_timestamp()
        )
      )
    order by coalesce(d.next_attempt_at, d.available_at), d.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_deliveries d
    set
      state = 'processing',
      lease_owner = trim(p_worker_id),
      lease_acquired_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
    from candidates c
    where d.id = c.id
    returning
      d.id,
      d.studio_id,
      d.job_id,
      d.notification_id,
      d.channel_key,
      d.adapter_key,
      d.attempt_count,
      d.max_attempts
  )
  select
    c.id,
    c.studio_id,
    c.job_id,
    c.notification_id,
    c.channel_key,
    c.adapter_key,
    c.attempt_count,
    c.max_attempts
  from claimed c;
end;
$$;

create or replace function public.system_set_notification_delivery_message_snapshot(
  p_delivery_id uuid,
  p_worker_id text,
  p_message_snapshot jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_message_snapshot is null or jsonb_typeof(p_message_snapshot) <> 'object' then
    raise exception 'notification_delivery_message_snapshot_invalid';
  end if;

  update public.notification_deliveries d
  set
    message_snapshot = p_message_snapshot,
    updated_at = clock_timestamp()
  where d.id = p_delivery_id
    and d.state = 'processing'
    and d.lease_owner = trim(coalesce(p_worker_id, ''))
    and d.lease_expires_at is not null
    and d.lease_expires_at > clock_timestamp();

  return found;
end;
$$;

create or replace function public.system_start_notification_delivery_attempt(
  p_delivery_id uuid,
  p_worker_id text,
  p_provider_key text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_attempt_number integer;
  v_attempt_id uuid;
begin
  select *
    into v_delivery
  from public.notification_deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'notification_delivery_not_found';
  end if;

  if v_delivery.state <> 'processing'
     or v_delivery.lease_owner is distinct from trim(coalesce(p_worker_id, ''))
     or v_delivery.lease_expires_at is null
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception 'notification_delivery_lease_invalid';
  end if;

  if v_delivery.attempt_count >= v_delivery.max_attempts then
    raise exception 'notification_delivery_attempts_exhausted';
  end if;

  if v_delivery.expires_at is not null
     and v_delivery.expires_at <= clock_timestamp() then
    raise exception 'notification_delivery_expired';
  end if;

  v_attempt_number := v_delivery.attempt_count + 1;

  update public.notification_deliveries
  set
    attempt_count = v_attempt_number,
    provider_key = coalesce(
      nullif(trim(coalesce(p_provider_key, '')), ''),
      provider_key
    ),
    updated_at = clock_timestamp()
  where id = p_delivery_id;

  insert into public.notification_delivery_attempts (
    studio_id,
    delivery_id,
    attempt_number,
    state,
    adapter_key,
    provider_key,
    started_at
  ) values (
    v_delivery.studio_id,
    v_delivery.id,
    v_attempt_number,
    'started',
    v_delivery.adapter_key,
    coalesce(
      nullif(trim(coalesce(p_provider_key, '')), ''),
      v_delivery.provider_key
    ),
    clock_timestamp()
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

create or replace function public.system_mark_notification_delivery_attempt_accepted(
  p_attempt_id uuid,
  p_provider_message_id text default null,
  p_http_status integer default null,
  p_response_snapshot jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery_id uuid;
begin
  if p_response_snapshot is null or jsonb_typeof(p_response_snapshot) <> 'object' then
    raise exception 'notification_delivery_response_snapshot_invalid';
  end if;

  update public.notification_delivery_attempts a
  set
    state = 'accepted',
    provider_message_id = nullif(trim(coalesce(p_provider_message_id, '')), ''),
    http_status = p_http_status,
    response_snapshot = p_response_snapshot,
    finished_at = clock_timestamp()
  where a.id = p_attempt_id
    and a.state = 'started'
  returning a.delivery_id into v_delivery_id;

  if v_delivery_id is null then
    return false;
  end if;

  update public.notification_deliveries d
  set
    state = 'accepted',
    provider_message_id = nullif(trim(coalesce(p_provider_message_id, '')), ''),
    next_attempt_at = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = null,
    last_error_code = null,
    last_error_safe = null,
    accepted_at = coalesce(d.accepted_at, clock_timestamp()),
    completed_at = coalesce(d.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where d.id = v_delivery_id;

  return true;
end;
$$;

create or replace function public.system_mark_notification_delivery_attempt_delivered(
  p_attempt_id uuid,
  p_provider_message_id text default null,
  p_http_status integer default null,
  p_response_snapshot jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery_id uuid;
begin
  if p_response_snapshot is null or jsonb_typeof(p_response_snapshot) <> 'object' then
    raise exception 'notification_delivery_response_snapshot_invalid';
  end if;

  update public.notification_delivery_attempts a
  set
    state = 'delivered',
    provider_message_id = coalesce(
      nullif(trim(coalesce(p_provider_message_id, '')), ''),
      a.provider_message_id
    ),
    http_status = coalesce(p_http_status, a.http_status),
    response_snapshot = p_response_snapshot,
    delivered_at = coalesce(a.delivered_at, clock_timestamp()),
    finished_at = coalesce(a.finished_at, clock_timestamp())
  where a.id = p_attempt_id
    and a.state in ('started','accepted')
  returning a.delivery_id into v_delivery_id;

  if v_delivery_id is null then
    return false;
  end if;

  update public.notification_deliveries d
  set
    state = 'delivered',
    provider_message_id = coalesce(
      nullif(trim(coalesce(p_provider_message_id, '')), ''),
      d.provider_message_id
    ),
    next_attempt_at = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = null,
    last_error_code = null,
    last_error_safe = null,
    accepted_at = coalesce(d.accepted_at, clock_timestamp()),
    delivered_at = coalesce(d.delivered_at, clock_timestamp()),
    completed_at = coalesce(d.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where d.id = v_delivery_id;

  return true;
end;
$$;

create or replace function public.system_mark_notification_delivery_attempt_failed(
  p_attempt_id uuid,
  p_retryable boolean,
  p_error_category text,
  p_error_code text,
  p_error_message_safe text default null,
  p_http_status integer default null,
  p_response_snapshot jsonb default '{}'::jsonb,
  p_retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_delivery_id uuid;
  v_retry boolean;
begin
  if p_response_snapshot is null or jsonb_typeof(p_response_snapshot) <> 'object' then
    raise exception 'notification_delivery_response_snapshot_invalid';
  end if;
  if p_retry_after_seconds is null or p_retry_after_seconds < 1 or p_retry_after_seconds > 86400 then
    raise exception 'notification_delivery_retry_delay_invalid';
  end if;

  select a.delivery_id
    into v_delivery_id
  from public.notification_delivery_attempts a
  where a.id = p_attempt_id
  for update;

  if v_delivery_id is null then
    return false;
  end if;

  select *
    into v_delivery
  from public.notification_deliveries d
  where d.id = v_delivery_id
  for update;

  v_retry :=
    coalesce(p_retryable, false)
    and v_delivery.attempt_count < v_delivery.max_attempts
    and (v_delivery.expires_at is null or v_delivery.expires_at > clock_timestamp());

  update public.notification_delivery_attempts a
  set
    state = case when v_retry then 'failed_transient' else 'failed_permanent' end,
    http_status = p_http_status,
    error_category = nullif(trim(coalesce(p_error_category, '')), ''),
    error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    error_message_safe = nullif(left(trim(coalesce(p_error_message_safe, '')), 1000), ''),
    response_snapshot = p_response_snapshot,
    finished_at = clock_timestamp()
  where a.id = p_attempt_id
    and a.state = 'started';

  update public.notification_deliveries d
  set
    state = case when v_retry then 'retry_wait' else 'failed_permanent' end,
    available_at = case
      when v_retry then clock_timestamp() + make_interval(secs => p_retry_after_seconds)
      else d.available_at
    end,
    next_attempt_at = case
      when v_retry then clock_timestamp() + make_interval(secs => p_retry_after_seconds)
      else null
    end,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = nullif(trim(coalesce(p_error_category, '')), ''),
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    last_error_safe = nullif(left(trim(coalesce(p_error_message_safe, '')), 1000), ''),
    completed_at = case
      when v_retry then null
      else coalesce(d.completed_at, clock_timestamp())
    end,
    updated_at = clock_timestamp()
  where d.id = v_delivery_id;

  return true;
end;
$$;

create or replace function public.system_mark_notification_delivery_attempt_skipped(
  p_attempt_id uuid,
  p_reason_code text,
  p_reason_safe text default null,
  p_response_snapshot jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery_id uuid;
begin
  if p_response_snapshot is null or jsonb_typeof(p_response_snapshot) <> 'object' then
    raise exception 'notification_delivery_response_snapshot_invalid';
  end if;

  update public.notification_delivery_attempts a
  set
    state = 'skipped',
    error_category = 'adapter',
    error_code = nullif(trim(coalesce(p_reason_code, '')), ''),
    error_message_safe = nullif(left(trim(coalesce(p_reason_safe, '')), 1000), ''),
    response_snapshot = p_response_snapshot,
    finished_at = clock_timestamp()
  where a.id = p_attempt_id
    and a.state = 'started'
  returning a.delivery_id into v_delivery_id;

  if v_delivery_id is null then
    return false;
  end if;

  update public.notification_deliveries d
  set
    state = 'skipped',
    next_attempt_at = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = 'adapter',
    last_error_code = nullif(trim(coalesce(p_reason_code, '')), ''),
    last_error_safe = nullif(left(trim(coalesce(p_reason_safe, '')), 1000), ''),
    completed_at = coalesce(d.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where d.id = v_delivery_id;

  return true;
end;
$$;

revoke all on function public.system_accept_notification_delivery_handoff(uuid,text)
from public, anon, authenticated;
revoke all on function public.system_claim_notification_deliveries(text,integer,integer)
from public, anon, authenticated;
revoke all on function public.system_set_notification_delivery_message_snapshot(uuid,text,jsonb)
from public, anon, authenticated;
revoke all on function public.system_start_notification_delivery_attempt(uuid,text,text)
from public, anon, authenticated;
revoke all on function public.system_mark_notification_delivery_attempt_accepted(uuid,text,integer,jsonb)
from public, anon, authenticated;
revoke all on function public.system_mark_notification_delivery_attempt_delivered(uuid,text,integer,jsonb)
from public, anon, authenticated;
revoke all on function public.system_mark_notification_delivery_attempt_failed(uuid,boolean,text,text,text,integer,jsonb,integer)
from public, anon, authenticated;
revoke all on function public.system_mark_notification_delivery_attempt_skipped(uuid,text,text,jsonb)
from public, anon, authenticated;

grant execute on function public.system_accept_notification_delivery_handoff(uuid,text)
to service_role;
grant execute on function public.system_claim_notification_deliveries(text,integer,integer)
to service_role;
grant execute on function public.system_set_notification_delivery_message_snapshot(uuid,text,jsonb)
to service_role;
grant execute on function public.system_start_notification_delivery_attempt(uuid,text,text)
to service_role;
grant execute on function public.system_mark_notification_delivery_attempt_accepted(uuid,text,integer,jsonb)
to service_role;
grant execute on function public.system_mark_notification_delivery_attempt_delivered(uuid,text,integer,jsonb)
to service_role;
grant execute on function public.system_mark_notification_delivery_attempt_failed(uuid,boolean,text,text,text,integer,jsonb,integer)
to service_role;
grant execute on function public.system_mark_notification_delivery_attempt_skipped(uuid,text,text,jsonb)
to service_role;
