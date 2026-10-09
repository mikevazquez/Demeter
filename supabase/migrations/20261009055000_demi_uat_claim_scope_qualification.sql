CREATE OR REPLACE FUNCTION public.service_claim_demi_uat_deliveries(p_studio uuid, p_worker_id text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60)
 RETURNS TABLE(delivery_id uuid, studio_id uuid, job_id uuid, notification_id uuid, channel_key text, adapter_key text, attempt_count integer, max_attempts integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (select auth.role()) is distinct from 'service_role' or not exists(select 1 from public.demi_uat_runs r where r.studio_id=p_studio) then raise exception 'forbidden'; end if;
  if trim(coalesce(p_worker_id, '')) = '' then
    raise exception 'notification_delivery_worker_id_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'notification_delivery_claim_limit_invalid';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'notification_delivery_lease_invalid';
  end if;

  -- Deliberately avoid the global reconciler for this tenant-scoped manual run.

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
  where d.studio_id=p_studio and d.expires_at is not null
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
    where d.studio_id=p_studio and private.studio_has_module(d.studio_id, 'notifications')
      and d.attempt_count < d.max_attempts
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
$function$;
revoke all on function public.service_claim_demi_uat_deliveries(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.service_claim_demi_uat_deliveries(uuid,text,integer,integer) to service_role;
CREATE OR REPLACE FUNCTION public.service_claim_demi_uat_jobs(p_studio uuid, p_worker_id text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60)
 RETURNS TABLE(job_id uuid, studio_id uuid, notification_id uuid, channel_key text, is_required boolean, attempt_count integer, max_attempts integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_notification_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' or not exists(select 1 from public.demi_uat_runs r where r.studio_id=p_studio) then raise exception 'forbidden'; end if;
  if trim(coalesce(p_worker_id,''))='' then raise exception 'notification_worker_id_required'; end if;
  if p_limit is null or p_limit<1 or p_limit>200 then raise exception 'notification_claim_limit_invalid'; end if;
  if p_lease_seconds is null or p_lease_seconds<10 or p_lease_seconds>900 then raise exception 'notification_lease_invalid'; end if;

  update public.notification_jobs j set
    state='expired',
    state_reason_code='delivery_window_elapsed',
    state_reason_detail=null,
    state_actor_type='system',state_actor_id=null,
    lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,
    completed_at=coalesce(j.completed_at,clock_timestamp())
  where j.studio_id=p_studio and j.state in ('ready','scheduled','retry_wait')
    and j.expires_at is not null
    and j.expires_at<=clock_timestamp();

  for v_notification_id in
    select distinct j.notification_id
    from public.notification_jobs j
    where j.studio_id=p_studio and private.studio_has_module(j.studio_id, 'notifications')
      and j.attempt_count<j.max_attempts
      and (j.expires_at is null or j.expires_at>clock_timestamp())
      and (
        (j.state='ready' and j.available_at<=clock_timestamp())
        or (j.state='scheduled' and j.scheduled_at<=clock_timestamp() and j.available_at<=clock_timestamp())
        or (j.state='retry_wait' and coalesce(j.next_attempt_at,j.available_at)<=clock_timestamp())
        or (j.state='processing' and j.lease_expires_at is not null and j.lease_expires_at<=clock_timestamp())
      )
    order by j.notification_id
    limit least(p_limit*2,400)
  loop
    perform public.system_revalidate_notification_contact(v_notification_id);
  end loop;

  return query
  with candidates as (
    select j.id
    from public.notification_jobs j
    where j.studio_id=p_studio and private.studio_has_module(j.studio_id, 'notifications')
      and j.attempt_count<j.max_attempts
      and (j.expires_at is null or j.expires_at>clock_timestamp())
      and (
        (j.state='ready' and j.available_at<=clock_timestamp())
        or (j.state='scheduled' and j.scheduled_at<=clock_timestamp() and j.available_at<=clock_timestamp())
        or (j.state='retry_wait' and coalesce(j.next_attempt_at,j.available_at)<=clock_timestamp())
        or (j.state='processing' and j.lease_expires_at is not null and j.lease_expires_at<=clock_timestamp())
      )
    order by coalesce(j.next_attempt_at,j.scheduled_at,j.available_at),j.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_jobs j set
      state='processing',
      state_reason_code='handoff_worker_claimed',
      state_reason_detail=null,
      state_actor_type='system',state_actor_id=null,
      lease_owner=trim(p_worker_id),
      lease_acquired_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from candidates c
    where j.id=c.id
    returning j.id,j.studio_id,j.notification_id,j.channel_key,j.is_required,j.attempt_count,j.max_attempts
  )
  select c.id,c.studio_id,c.notification_id,c.channel_key,c.is_required,c.attempt_count,c.max_attempts
  from claimed c;
end;
$function$;
revoke all on function public.service_claim_demi_uat_jobs(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.service_claim_demi_uat_jobs(uuid,text,integer,integer) to service_role;

