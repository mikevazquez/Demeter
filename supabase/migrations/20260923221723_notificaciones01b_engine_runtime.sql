-- NOTIFICACIONES-01B · Runtime contracts and state machinery.
-- Internal-only RPCs for claiming work, attempts, retries and state aggregation.

create or replace function private.notifications_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.notifications_touch_updated_at() from public, anon, authenticated;

create trigger notification_channels_touch_updated_at
before update on public.notification_channels
for each row execute function private.notifications_touch_updated_at();

create trigger notification_rules_touch_updated_at
before update on public.notification_rules
for each row execute function private.notifications_touch_updated_at();

create trigger notification_event_processings_touch_updated_at
before update on public.notification_event_processings
for each row execute function private.notifications_touch_updated_at();

create trigger notifications_touch_updated_at
before update on public.notifications
for each row execute function private.notifications_touch_updated_at();

create trigger notification_jobs_touch_updated_at
before update on public.notification_jobs
for each row execute function private.notifications_touch_updated_at();

create or replace function private.enqueue_notification_event_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_event_processings (
    studio_id,
    event_id,
    engine_key,
    state,
    available_at
  ) values (
    new.studio_id,
    new.event_id,
    'notification_engine:v1',
    'pending',
    clock_timestamp()
  )
  on conflict (event_id, engine_key) do nothing;

  return new;
end;
$$;

revoke all on function private.enqueue_notification_event_processing() from public, anon, authenticated;

create trigger domain_events_enqueue_notification_engine
after insert on public.domain_events
for each row execute function private.enqueue_notification_event_processing();

create or replace function private.log_notification_state_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from_state text;
begin
  if tg_op = 'UPDATE' and old.state is not distinct from new.state then
    return new;
  end if;

  v_from_state := case when tg_op = 'INSERT' then null else old.state end;

  if tg_table_name = 'notifications' then
    insert into public.notification_state_transitions (
      studio_id,
      notification_id,
      from_state,
      to_state,
      reason_code,
      reason_detail,
      actor_type,
      actor_id
    ) values (
      new.studio_id,
      new.id,
      v_from_state,
      new.state,
      coalesce(new.state_reason_code, case when tg_op = 'INSERT' then 'created' else 'state_changed' end),
      new.state_reason_detail,
      coalesce(nullif(trim(new.state_actor_type), ''), 'system'),
      new.state_actor_id
    );
  elsif tg_table_name = 'notification_jobs' then
    insert into public.notification_state_transitions (
      studio_id,
      job_id,
      from_state,
      to_state,
      reason_code,
      reason_detail,
      actor_type,
      actor_id
    ) values (
      new.studio_id,
      new.id,
      v_from_state,
      new.state,
      coalesce(new.state_reason_code, case when tg_op = 'INSERT' then 'created' else 'state_changed' end),
      new.state_reason_detail,
      coalesce(nullif(trim(new.state_actor_type), ''), 'system'),
      new.state_actor_id
    );
  end if;

  return new;
end;
$$;

revoke all on function private.log_notification_state_transition() from public, anon, authenticated;

create trigger notifications_log_state_transition
after insert or update of state on public.notifications
for each row execute function private.log_notification_state_transition();

create trigger notification_jobs_log_state_transition
after insert or update of state on public.notification_jobs
for each row execute function private.log_notification_state_transition();

create or replace function private.recalculate_notification_state(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_total integer := 0;
  v_required_total integer := 0;
  v_required_success integer := 0;
  v_required_failed integer := 0;
  v_inflight integer := 0;
  v_processing integer := 0;
  v_any_success integer := 0;
  v_all_cancelled boolean := false;
  v_all_suppressed boolean := false;
  v_new_state text;
begin
  select *
    into v_notification
  from public.notifications n
  where n.id = p_notification_id
  for update;

  if not found then
    return;
  end if;

  if v_notification.state in ('cancelled','suppressed') then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where j.is_required)::integer,
    count(*) filter (
      where j.is_required
        and (
          j.state = 'delivered'
          or (j.state = 'sent' and not c.supports_delivery_receipts)
        )
    )::integer,
    count(*) filter (
      where j.is_required and j.state in ('failed','expired')
    )::integer,
    count(*) filter (
      where j.state in ('pending','scheduled','processing','retrying')
    )::integer,
    count(*) filter (where j.state = 'processing')::integer,
    count(*) filter (
      where j.state = 'delivered'
         or (j.state = 'sent' and not c.supports_delivery_receipts)
    )::integer,
    coalesce(bool_and(j.state = 'cancelled'), false),
    coalesce(bool_and(j.state = 'suppressed'), false)
  into
    v_total,
    v_required_total,
    v_required_success,
    v_required_failed,
    v_inflight,
    v_processing,
    v_any_success,
    v_all_cancelled,
    v_all_suppressed
  from public.notification_jobs j
  join public.notification_channels c
    on c.channel_key = j.channel_key
  where j.notification_id = p_notification_id;

  if v_total = 0 then
    v_new_state := case
      when v_notification.scheduled_for is not null
       and v_notification.scheduled_for > clock_timestamp()
      then 'scheduled'
      else 'pending'
    end;
  elsif v_all_cancelled then
    v_new_state := 'cancelled';
  elsif v_all_suppressed then
    v_new_state := 'suppressed';
  elsif v_required_failed > 0 and v_inflight = 0 then
    v_new_state := 'failed';
  elsif v_required_total > 0
    and v_required_success = v_required_total
    and v_inflight = 0 then
    v_new_state := 'completed';
  elsif v_any_success > 0 then
    v_new_state := 'partially_completed';
  elsif v_processing > 0 then
    v_new_state := 'processing';
  elsif exists (
    select 1
    from public.notification_jobs j
    where j.notification_id = p_notification_id
      and j.state = 'scheduled'
  ) then
    v_new_state := 'scheduled';
  else
    v_new_state := 'pending';
  end if;

  if v_new_state is distinct from v_notification.state then
    update public.notifications
    set
      state = v_new_state,
      state_reason_code = 'jobs_recalculated',
      state_reason_detail = null,
      state_actor_type = 'system',
      state_actor_id = null,
      cancelled_at = case
        when v_new_state = 'cancelled' then coalesce(cancelled_at, clock_timestamp())
        else cancelled_at
      end,
      suppressed_at = case
        when v_new_state = 'suppressed' then coalesce(suppressed_at, clock_timestamp())
        else suppressed_at
      end,
      completed_at = case
        when v_new_state in ('completed','failed') then coalesce(completed_at, clock_timestamp())
        else completed_at
      end
    where id = p_notification_id;
  end if;
end;
$$;

revoke all on function private.recalculate_notification_state(uuid) from public, anon, authenticated;

create or replace function private.notification_job_recalculate_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalculate_notification_state(new.notification_id);
  return new;
end;
$$;

revoke all on function private.notification_job_recalculate_parent() from public, anon, authenticated;

create trigger notification_jobs_recalculate_parent
after insert or update of state on public.notification_jobs
for each row execute function private.notification_job_recalculate_parent();

create or replace function public.system_claim_notification_events(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns table (
  processing_id uuid,
  studio_id uuid,
  event_id uuid,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
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

  return query
  with candidates as (
    select p.id
    from public.notification_event_processings p
    where p.attempt_count < p.max_attempts
      and (
        (
          p.state in ('pending','failed')
          and p.available_at <= clock_timestamp()
        )
        or (
          p.state = 'processing'
          and p.lease_expires_at is not null
          and p.lease_expires_at <= clock_timestamp()
        )
      )
    order by p.available_at, p.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_event_processings p
    set
      state = 'processing',
      attempt_count = p.attempt_count + 1,
      lease_owner = trim(p_worker_id),
      lease_acquired_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      completed_at = null
    from candidates c
    where p.id = c.id
    returning p.id, p.studio_id, p.event_id, p.attempt_count
  )
  select c.id, c.studio_id, c.event_id, c.attempt_count
  from claimed c;
end;
$$;

revoke all on function public.system_claim_notification_events(text,integer,integer)
from public, anon, authenticated;
grant execute on function public.system_claim_notification_events(text,integer,integer)
to service_role;

create or replace function public.system_complete_notification_event(
  p_processing_id uuid,
  p_worker_id text,
  p_rules_evaluated integer default 0,
  p_notifications_created integer default 0,
  p_notifications_suppressed integer default 0,
  p_jobs_created integer default 0,
  p_duplicates_skipped integer default 0
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.notification_event_processings p
  set
    state = 'completed',
    rules_evaluated = greatest(coalesce(p_rules_evaluated, 0), 0),
    notifications_created = greatest(coalesce(p_notifications_created, 0), 0),
    notifications_suppressed = greatest(coalesce(p_notifications_suppressed, 0), 0),
    jobs_created = greatest(coalesce(p_jobs_created, 0), 0),
    duplicates_skipped = greatest(coalesce(p_duplicates_skipped, 0), 0),
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_code = null,
    last_error_safe = null,
    completed_at = clock_timestamp()
  where p.id = p_processing_id
    and p.state = 'processing'
    and p.lease_owner = trim(coalesce(p_worker_id, ''));

  return found;
end;
$$;

revoke all on function public.system_complete_notification_event(uuid,text,integer,integer,integer,integer,integer)
from public, anon, authenticated;
grant execute on function public.system_complete_notification_event(uuid,text,integer,integer,integer,integer,integer)
to service_role;

create or replace function public.system_fail_notification_event(
  p_processing_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_safe text default null,
  p_retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_retry_after_seconds is null or p_retry_after_seconds < 1 or p_retry_after_seconds > 86400 then
    raise exception 'notification_retry_delay_invalid';
  end if;

  update public.notification_event_processings p
  set
    state = 'failed',
    available_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    last_error_safe = nullif(left(trim(coalesce(p_error_safe, '')), 1000), ''),
    completed_at = null
  where p.id = p_processing_id
    and p.state = 'processing'
    and p.lease_owner = trim(coalesce(p_worker_id, ''));

  return found;
end;
$$;

revoke all on function public.system_fail_notification_event(uuid,text,text,text,integer)
from public, anon, authenticated;
grant execute on function public.system_fail_notification_event(uuid,text,text,text,integer)
to service_role;

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

create or replace function public.system_start_notification_attempt(
  p_job_id uuid,
  p_worker_id text,
  p_adapter_key text,
  p_provider_key text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.notification_jobs%rowtype;
  v_attempt_number integer;
  v_attempt_id uuid;
begin
  if trim(coalesce(p_adapter_key, '')) = '' then
    raise exception 'notification_adapter_key_required';
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
    raise exception 'notification_job_lease_invalid';
  end if;

  if v_job.attempt_count >= v_job.max_attempts then
    raise exception 'notification_job_attempts_exhausted';
  end if;

  v_attempt_number := v_job.attempt_count + 1;

  update public.notification_jobs
  set
    attempt_count = v_attempt_number,
    last_attempt_at = clock_timestamp()
  where id = p_job_id;

  insert into public.notification_attempts (
    studio_id,
    job_id,
    attempt_number,
    state,
    adapter_key,
    provider_key,
    started_at
  ) values (
    v_job.studio_id,
    v_job.id,
    v_attempt_number,
    'started',
    trim(p_adapter_key),
    nullif(trim(coalesce(p_provider_key, '')), ''),
    clock_timestamp()
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

revoke all on function public.system_start_notification_attempt(uuid,text,text,text)
from public, anon, authenticated;
grant execute on function public.system_start_notification_attempt(uuid,text,text,text)
to service_role;

create or replace function public.system_mark_notification_attempt_accepted(
  p_attempt_id uuid,
  p_provider_message_id text default null,
  p_http_status integer default null,
  p_response_safe jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_supports_receipts boolean;
begin
  if p_response_safe is null or jsonb_typeof(p_response_safe) <> 'object' then
    raise exception 'notification_provider_response_must_be_object';
  end if;

  update public.notification_attempts a
  set
    state = 'accepted',
    provider_message_id = nullif(trim(coalesce(p_provider_message_id, '')), ''),
    http_status = p_http_status,
    provider_response_safe = p_response_safe,
    finished_at = clock_timestamp()
  where a.id = p_attempt_id
    and a.state = 'started'
  returning a.job_id into v_job_id;

  if v_job_id is null then
    return false;
  end if;

  select c.supports_delivery_receipts
    into v_supports_receipts
  from public.notification_jobs j
  join public.notification_channels c on c.channel_key = j.channel_key
  where j.id = v_job_id;

  update public.notification_jobs j
  set
    state = 'sent',
    state_reason_code = 'provider_accepted',
    state_reason_detail = null,
    state_actor_type = 'system',
    state_actor_id = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = null,
    last_error_code = null,
    completed_at = case
      when not coalesce(v_supports_receipts, false) then coalesce(j.completed_at, clock_timestamp())
      else j.completed_at
    end
  where j.id = v_job_id;

  return true;
end;
$$;

revoke all on function public.system_mark_notification_attempt_accepted(uuid,text,integer,jsonb)
from public, anon, authenticated;
grant execute on function public.system_mark_notification_attempt_accepted(uuid,text,integer,jsonb)
to service_role;

create or replace function public.system_mark_notification_attempt_delivered(
  p_attempt_id uuid,
  p_response_safe jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_response_safe is null or jsonb_typeof(p_response_safe) <> 'object' then
    raise exception 'notification_provider_response_must_be_object';
  end if;

  update public.notification_attempts a
  set
    state = 'delivered',
    provider_response_safe = case
      when p_response_safe = '{}'::jsonb then a.provider_response_safe
      else p_response_safe
    end,
    delivered_at = coalesce(a.delivered_at, clock_timestamp()),
    finished_at = coalesce(a.finished_at, clock_timestamp())
  where a.id = p_attempt_id
    and a.state in ('started','accepted')
  returning a.job_id into v_job_id;

  if v_job_id is null then
    return false;
  end if;

  update public.notification_jobs j
  set
    state = 'delivered',
    state_reason_code = 'provider_delivered',
    state_reason_detail = null,
    state_actor_type = 'system',
    state_actor_id = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = null,
    last_error_code = null,
    completed_at = coalesce(j.completed_at, clock_timestamp())
  where j.id = v_job_id;

  return true;
end;
$$;

revoke all on function public.system_mark_notification_attempt_delivered(uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.system_mark_notification_attempt_delivered(uuid,jsonb)
to service_role;

create or replace function public.system_mark_notification_attempt_failed(
  p_attempt_id uuid,
  p_retryable boolean,
  p_error_category text,
  p_error_code text,
  p_error_message_safe text default null,
  p_http_status integer default null,
  p_response_safe jsonb default '{}'::jsonb,
  p_retry_after_seconds integer default 60,
  p_timed_out boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.notification_jobs%rowtype;
  v_job_id uuid;
  v_retry boolean;
  v_attempt_state text;
begin
  if p_response_safe is null or jsonb_typeof(p_response_safe) <> 'object' then
    raise exception 'notification_provider_response_must_be_object';
  end if;
  if p_retry_after_seconds is null or p_retry_after_seconds < 1 or p_retry_after_seconds > 86400 then
    raise exception 'notification_retry_delay_invalid';
  end if;

  select a.job_id
    into v_job_id
  from public.notification_attempts a
  where a.id = p_attempt_id
  for update;

  if v_job_id is null then
    return false;
  end if;

  select *
    into v_job
  from public.notification_jobs j
  where j.id = v_job_id
  for update;

  v_retry :=
    coalesce(p_retryable, false)
    and v_job.attempt_count < v_job.max_attempts
    and (v_job.expires_at is null or v_job.expires_at > clock_timestamp());

  v_attempt_state := case
    when coalesce(p_timed_out, false) then 'timed_out'
    when v_retry then 'failed_transient'
    else 'failed_permanent'
  end;

  update public.notification_attempts a
  set
    state = v_attempt_state,
    http_status = p_http_status,
    error_category = nullif(trim(coalesce(p_error_category, '')), ''),
    error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    error_message_safe = nullif(left(trim(coalesce(p_error_message_safe, '')), 1000), ''),
    provider_response_safe = p_response_safe,
    finished_at = clock_timestamp()
  where a.id = p_attempt_id
    and a.state in ('started','accepted');

  update public.notification_jobs j
  set
    state = case when v_retry then 'retrying' else 'failed' end,
    state_reason_code = case when v_retry then 'retry_scheduled' else 'delivery_failed' end,
    state_reason_detail = nullif(left(trim(coalesce(p_error_code, '')), 500), ''),
    state_actor_type = 'system',
    state_actor_id = null,
    next_attempt_at = case
      when v_retry then clock_timestamp() + make_interval(secs => p_retry_after_seconds)
      else null
    end,
    available_at = case
      when v_retry then clock_timestamp() + make_interval(secs => p_retry_after_seconds)
      else j.available_at
    end,
    last_error_category = nullif(trim(coalesce(p_error_category, '')), ''),
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    completed_at = case when v_retry then null else coalesce(j.completed_at, clock_timestamp()) end
  where j.id = v_job_id;

  return true;
end;
$$;

revoke all on function public.system_mark_notification_attempt_failed(uuid,boolean,text,text,text,integer,jsonb,integer,boolean)
from public, anon, authenticated;
grant execute on function public.system_mark_notification_attempt_failed(uuid,boolean,text,text,text,integer,jsonb,integer,boolean)
to service_role;

create or replace function public.system_cancel_notification_job(
  p_job_id uuid,
  p_reason_code text,
  p_reason_detail text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.notification_jobs j
  set
    state = 'cancelled',
    state_reason_code = coalesce(nullif(trim(coalesce(p_reason_code, '')), ''), 'cancelled'),
    state_reason_detail = nullif(left(trim(coalesce(p_reason_detail, '')), 1000), ''),
    state_actor_type = 'system',
    state_actor_id = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    next_attempt_at = null,
    completed_at = coalesce(j.completed_at, clock_timestamp())
  where j.id = p_job_id
    and j.state in ('pending','scheduled','processing','retrying');

  return found;
end;
$$;

revoke all on function public.system_cancel_notification_job(uuid,text,text)
from public, anon, authenticated;
grant execute on function public.system_cancel_notification_job(uuid,text,text)
to service_role;

create or replace function public.system_recalculate_notification_state(
  p_notification_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.notifications n where n.id = p_notification_id
  ) then
    return false;
  end if;

  perform private.recalculate_notification_state(p_notification_id);
  return true;
end;
$$;

revoke all on function public.system_recalculate_notification_state(uuid)
from public, anon, authenticated;
grant execute on function public.system_recalculate_notification_state(uuid)
to service_role;
