-- NOTIFICACIONES-01C · Recover attempts left open by a dead delivery worker.

create or replace function private.reconcile_stale_notification_delivery_attempts()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale_deliveries as (
    select d.id
    from public.notification_deliveries d
    where d.state = 'processing'
      and d.lease_expires_at is not null
      and d.lease_expires_at <= clock_timestamp()
  )
  update public.notification_delivery_attempts a
  set
    state = 'failed_transient',
    error_category = 'worker',
    error_code = 'delivery_worker_lease_expired',
    error_message_safe = 'Delivery worker lease expired before the attempt was finalized.',
    finished_at = coalesce(a.finished_at, clock_timestamp())
  where a.state = 'started'
    and a.delivery_id in (select id from stale_deliveries);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.reconcile_stale_notification_delivery_attempts()
from public, anon, authenticated;

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

  perform private.reconcile_stale_notification_delivery_attempts();

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

revoke all on function public.system_claim_notification_deliveries(text,integer,integer)
from public, anon, authenticated;
grant execute on function public.system_claim_notification_deliveries(text,integer,integer)
to service_role;
