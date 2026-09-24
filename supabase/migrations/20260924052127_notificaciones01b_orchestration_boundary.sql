-- NOTIFICACIONES-01B · Hard boundary: orchestration only.
-- Provider send/delivery truth and provider attempts are reserved for NOTIFICACIONES-01C.

begin;

drop function if exists public.system_mark_notification_attempt_accepted(uuid,text,integer,jsonb);
drop function if exists public.system_mark_notification_attempt_delivered(uuid,jsonb);
drop function if exists public.system_mark_notification_attempt_failed(uuid,boolean,text,text,text,integer,jsonb,integer,boolean);
drop function if exists public.system_start_notification_attempt(uuid,text,text,text);
drop function if exists public.system_recalculate_notification_state(uuid);

drop trigger if exists notification_jobs_recalculate_parent on public.notification_jobs;
drop function if exists private.notification_job_recalculate_parent();
drop function if exists private.recalculate_notification_state(uuid);

drop table if exists public.notification_attempts;

alter table public.notification_channels
  drop column if exists supports_delivery_receipts;

alter table public.notification_event_processings
  drop constraint if exists notification_event_processings_state_chk;

update public.notification_event_processings
set state = case state
  when 'completed' then 'processed'
  when 'failed' then 'retry_wait'
  else state
end;

alter table public.notification_event_processings
  add constraint notification_event_processings_state_chk
  check (state in ('pending','processing','processed','retry_wait','dead_letter'));

drop index if exists public.notification_event_processings_ready_idx;
create index notification_event_processings_ready_idx
  on public.notification_event_processings(state, available_at)
  where state in ('pending','retry_wait');

alter table public.notifications
  drop constraint if exists notifications_state_chk;

update public.notifications
set state = case
  when state in ('cancelled','suppressed') then state
  else 'active'
end;

alter table public.notifications
  add constraint notifications_state_chk
  check (state in ('active','cancelled','suppressed'));

alter table public.notifications
  drop column if exists completed_at;

alter table public.notification_jobs
  drop constraint if exists notification_jobs_state_chk;

update public.notification_jobs
set state = case state
  when 'pending' then 'ready'
  when 'retrying' then 'retry_wait'
  when 'sent' then 'handed_off'
  when 'delivered' then 'handed_off'
  when 'failed' then 'dead_letter'
  else state
end;

alter table public.notification_jobs
  add constraint notification_jobs_state_chk
  check (state in (
    'scheduled','ready','processing','handed_off','retry_wait',
    'cancelled','suppressed','expired','dead_letter'
  ));

alter table public.notification_jobs
  add column if not exists handed_off_at timestamptz;

drop index if exists public.notification_jobs_ready_idx;
create index notification_jobs_ready_idx
  on public.notification_jobs(state, available_at)
  where state in ('ready','scheduled','retry_wait');

drop function if exists public.system_materialize_notification(
  uuid,uuid,uuid,integer,text,text,uuid,uuid,jsonb,text,timestamptz,timestamptz,text,jsonb,text,jsonb,boolean,text,text
);

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
  if trim(coalesce(p_worker_id, '')) = '' then raise exception 'notification_worker_id_required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'notification_claim_limit_invalid'; end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then raise exception 'notification_lease_invalid'; end if;

  return query
  with candidates as (
    select p.id
    from public.notification_event_processings p
    where p.attempt_count < p.max_attempts
      and (
        (p.state in ('pending','retry_wait') and p.available_at <= clock_timestamp())
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
    state = 'processed',
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
declare
  v_processing public.notification_event_processings%rowtype;
  v_dead_letter boolean;
begin
  if p_retry_after_seconds is null or p_retry_after_seconds < 1 or p_retry_after_seconds > 86400 then
    raise exception 'notification_retry_delay_invalid';
  end if;

  select * into v_processing
  from public.notification_event_processings p
  where p.id = p_processing_id
  for update;

  if not found
     or v_processing.state <> 'processing'
     or v_processing.lease_owner is distinct from trim(coalesce(p_worker_id, '')) then
    return false;
  end if;

  v_dead_letter := v_processing.attempt_count >= v_processing.max_attempts;

  update public.notification_event_processings p
  set
    state = case when v_dead_letter then 'dead_letter' else 'retry_wait' end,
    available_at = case
      when v_dead_letter then p.available_at
      else clock_timestamp() + make_interval(secs => p_retry_after_seconds)
    end,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    last_error_safe = nullif(left(trim(coalesce(p_error_safe, '')), 1000), ''),
    completed_at = case when v_dead_letter then clock_timestamp() else null end
  where p.id = p_processing_id;

  return true;
end;
$$;

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
returns table (notification_id uuid, created boolean, jobs_created integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notification_id uuid;
  v_created boolean := false;
  v_jobs_created integer := 0;
  v_channel jsonb;
  v_channel_key text;
  v_is_required boolean;
  v_max_attempts integer;
  v_scheduled_at timestamptz;
begin
  if p_communication_class not in ('P0','P1','P2') then raise exception 'notification_communication_class_invalid'; end if;
  if p_recipient_snapshot is null or jsonb_typeof(p_recipient_snapshot) <> 'object' then raise exception 'notification_recipient_snapshot_must_be_object'; end if;
  if p_template_variables is null or jsonb_typeof(p_template_variables) <> 'object' then raise exception 'notification_template_variables_must_be_object'; end if;
  if p_channels is null or jsonb_typeof(p_channels) <> 'array' then raise exception 'notification_channels_must_be_array'; end if;
  if not coalesce(p_suppressed, false) and jsonb_array_length(p_channels) = 0 then raise exception 'notification_channels_required'; end if;

  insert into public.notifications (
    studio_id,source_event_id,rule_id,rule_version_number,
    notification_type,communication_class,recipient_type,recipient_entity_id,recipient_user_id,
    recipient_snapshot,priority,state,scheduled_for,expires_at,template_key,template_variables,
    deduplication_key,state_reason_code,state_reason_detail,state_actor_type,suppressed_at
  ) values (
    p_studio_id,p_source_event_id,p_rule_id,p_rule_version_number,
    trim(p_notification_type),p_communication_class,trim(p_recipient_type),p_recipient_entity_id,p_recipient_user_id,
    p_recipient_snapshot,p_priority,
    case when coalesce(p_suppressed,false) then 'suppressed' else 'active' end,
    p_scheduled_for,p_expires_at,trim(p_template_key),p_template_variables,
    trim(p_deduplication_key),
    case
      when coalesce(p_suppressed,false) then coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'suppressed')
      else 'created'
    end,
    nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),
    'system',
    case when coalesce(p_suppressed,false) then clock_timestamp() else null end
  )
  on conflict (studio_id,deduplication_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select n.id into v_notification_id
    from public.notifications n
    where n.studio_id=p_studio_id and n.deduplication_key=trim(p_deduplication_key);
    return query select v_notification_id,false,0;
    return;
  end if;

  v_created := true;

  if not coalesce(p_suppressed,false) then
    for v_channel in select value from jsonb_array_elements(p_channels)
    loop
      v_channel_key := nullif(trim(coalesce(v_channel->>'channel_key','')),'');
      if v_channel_key is null then raise exception 'notification_channel_key_required'; end if;
      if not exists(select 1 from public.notification_channels c where c.channel_key=v_channel_key and c.is_active) then
        raise exception 'notification_channel_inactive:%',v_channel_key;
      end if;

      v_is_required := coalesce((v_channel->>'is_required')::boolean,true);
      v_max_attempts := greatest(1,least(10,coalesce(nullif(v_channel#>>'{channel_policy,max_attempts}','')::integer,3)));
      v_scheduled_at := coalesce(p_scheduled_for,clock_timestamp());

      insert into public.notification_jobs (
        studio_id,notification_id,channel_key,is_required,state,
        scheduled_at,available_at,expires_at,max_attempts,
        channel_deduplication_key,state_reason_code,state_actor_type
      ) values (
        p_studio_id,v_notification_id,v_channel_key,v_is_required,
        case when v_scheduled_at > clock_timestamp() then 'scheduled' else 'ready' end,
        v_scheduled_at,v_scheduled_at,p_expires_at,v_max_attempts,
        v_notification_id::text||':'||v_channel_key,'created','system'
      );
      v_jobs_created := v_jobs_created + 1;
    end loop;
  end if;

  return query select v_notification_id,v_created,v_jobs_created;
end;
$$;

create or replace function public.system_revalidate_notification_contact(
  p_notification_id uuid
)
returns table (outcome text,effective_scheduled_for timestamptz,reason_code text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_result record;
begin
  select * into v_notification
  from public.notifications n
  where n.id=p_notification_id
  for update;

  if not found then raise exception 'notification_not_found'; end if;

  if v_notification.state in ('cancelled','suppressed') then
    return query select 'suppress'::text,null::timestamptz,('notification_'||v_notification.state)::text;
    return;
  end if;

  select * into v_result
  from private.evaluate_notification_contact(
    v_notification.studio_id,
    v_notification.recipient_type,
    v_notification.recipient_entity_id,
    v_notification.recipient_user_id,
    v_notification.communication_class,
    coalesce(v_notification.scheduled_for,clock_timestamp()),
    v_notification.expires_at,
    v_notification.id
  );

  insert into public.notification_contact_decisions(
    studio_id,source_event_id,rule_id,rule_version_number,notification_id,
    recipient_type,recipient_entity_id,recipient_user_id,communication_class,
    phase,outcome,reason_code,original_scheduled_for,effective_scheduled_for,policy_snapshot
  ) values (
    v_notification.studio_id,v_notification.source_event_id,v_notification.rule_id,v_notification.rule_version_number,v_notification.id,
    v_notification.recipient_type,v_notification.recipient_entity_id,v_notification.recipient_user_id,v_notification.communication_class,
    'pre_delivery',v_result.outcome,v_result.reason_code,
    coalesce(v_notification.scheduled_for,clock_timestamp()),v_result.effective_scheduled_for,v_result.policy_snapshot
  );

  if v_result.outcome='suppress' then
    update public.notifications set
      state='suppressed',state_reason_code=v_result.reason_code,
      state_reason_detail='Contact governor suppressed before handoff.',
      state_actor_type='system',state_actor_id=null,
      suppressed_at=coalesce(suppressed_at,clock_timestamp())
    where id=v_notification.id;

    update public.notification_jobs set
      state='suppressed',state_reason_code=v_result.reason_code,
      state_reason_detail='Contact governor suppressed before handoff.',
      state_actor_type='system',state_actor_id=null,
      lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,
      completed_at=coalesce(completed_at,clock_timestamp())
    where notification_id=v_notification.id
      and state in ('ready','scheduled','retry_wait','processing');

  elsif v_result.outcome='defer' then
    update public.notifications set
      scheduled_for=v_result.effective_scheduled_for,
      state_reason_code=v_result.reason_code,
      state_reason_detail='Contact governor deferred handoff.',
      state_actor_type='system',state_actor_id=null
    where id=v_notification.id;

    update public.notification_jobs set
      state='scheduled',
      scheduled_at=v_result.effective_scheduled_for,
      available_at=v_result.effective_scheduled_for,
      next_attempt_at=null,
      state_reason_code=v_result.reason_code,
      state_reason_detail='Contact governor deferred handoff.',
      state_actor_type='system',state_actor_id=null,
      lease_owner=null,lease_acquired_at=null,lease_expires_at=null
    where notification_id=v_notification.id
      and state in ('ready','scheduled','retry_wait','processing');
  end if;

  return query select v_result.outcome::text,v_result.effective_scheduled_for::timestamptz,v_result.reason_code::text;
end;
$$;

create or replace function public.system_claim_notification_jobs(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,studio_id uuid,notification_id uuid,channel_key text,
  is_required boolean,attempt_count integer,max_attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare v_notification_id uuid;
begin
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
  where j.state in ('ready','scheduled','retry_wait')
    and j.expires_at is not null
    and j.expires_at<=clock_timestamp();

  for v_notification_id in
    select distinct j.notification_id
    from public.notification_jobs j
    where j.attempt_count<j.max_attempts
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
    where j.attempt_count<j.max_attempts
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
$$;

create or replace function public.system_mark_notification_job_handed_off(
  p_job_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_job public.notification_jobs%rowtype;
begin
  select * into v_job
  from public.notification_jobs j
  where j.id=p_job_id
  for update;

  if not found
     or v_job.state<>'processing'
     or v_job.lease_owner is distinct from trim(coalesce(p_worker_id,''))
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at<=clock_timestamp() then
    return false;
  end if;

  update public.notification_jobs j set
    state='handed_off',
    attempt_count=j.attempt_count+1,
    last_attempt_at=clock_timestamp(),
    handed_off_at=clock_timestamp(),
    state_reason_code='adapter_handoff_complete',
    state_reason_detail=null,
    state_actor_type='system',state_actor_id=null,
    next_attempt_at=null,last_error_category=null,last_error_code=null,
    lease_owner=null,lease_acquired_at=null,lease_expires_at=null,
    completed_at=coalesce(j.completed_at,clock_timestamp())
  where j.id=p_job_id;

  return true;
end;
$$;

create or replace function public.system_fail_notification_job_handoff(
  p_job_id uuid,
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
declare
  v_job public.notification_jobs%rowtype;
  v_new_attempt_count integer;
  v_dead_letter boolean;
begin
  if p_retry_after_seconds is null or p_retry_after_seconds<1 or p_retry_after_seconds>86400 then
    raise exception 'notification_retry_delay_invalid';
  end if;

  select * into v_job
  from public.notification_jobs j
  where j.id=p_job_id
  for update;

  if not found
     or v_job.state<>'processing'
     or v_job.lease_owner is distinct from trim(coalesce(p_worker_id,''))
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at<=clock_timestamp() then
    return false;
  end if;

  v_new_attempt_count:=v_job.attempt_count+1;
  v_dead_letter:=v_new_attempt_count>=v_job.max_attempts
    or (v_job.expires_at is not null and v_job.expires_at<=clock_timestamp());

  update public.notification_jobs j set
    state=case when v_dead_letter then 'dead_letter' else 'retry_wait' end,
    attempt_count=v_new_attempt_count,
    last_attempt_at=clock_timestamp(),
    next_attempt_at=case when v_dead_letter then null else clock_timestamp()+make_interval(secs=>p_retry_after_seconds) end,
    available_at=case when v_dead_letter then j.available_at else clock_timestamp()+make_interval(secs=>p_retry_after_seconds) end,
    last_error_category='handoff',
    last_error_code=nullif(trim(coalesce(p_error_code,'')),''),
    state_reason_code=case when v_dead_letter then 'handoff_dead_letter' else 'handoff_retry_scheduled' end,
    state_reason_detail=nullif(left(trim(coalesce(p_error_safe,'')),1000),''),
    state_actor_type='system',state_actor_id=null,
    lease_owner=null,lease_acquired_at=null,lease_expires_at=null,
    completed_at=case when v_dead_letter then coalesce(j.completed_at,clock_timestamp()) else null end
  where j.id=p_job_id;

  return true;
end;
$$;

create or replace function public.system_cancel_notification_job(
  p_job_id uuid,p_reason_code text,p_reason_detail text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.notification_jobs j set
    state='cancelled',
    state_reason_code=coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'cancelled'),
    state_reason_detail=nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),
    state_actor_type='system',state_actor_id=null,
    lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,
    completed_at=coalesce(j.completed_at,clock_timestamp())
  where j.id=p_job_id
    and j.state in ('ready','scheduled','processing','retry_wait');

  return found;
end;
$$;

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
declare v_count integer;
begin
  with target_notifications as (
    select distinct n.id
    from public.notifications n
    join public.domain_events e
      on e.event_id=n.source_event_id and e.studio_id=n.studio_id
    where n.studio_id=p_studio_id
      and (
        (e.source_entity_type=trim(p_source_entity_type) and e.source_entity_id=p_source_entity_id)
        or (
          trim(p_source_entity_type)='reservation'
          and (
            n.recipient_snapshot->>'reservation_id'=p_source_entity_id::text
            or n.template_variables->>'reservation_id'=p_source_entity_id::text
          )
        )
      )
  ),
  targets as (
    select j.id,j.notification_id
    from public.notification_jobs j
    join target_notifications tn on tn.id=j.notification_id
    where j.state in ('ready','scheduled','processing','retry_wait')
    for update of j
  ),
  cancelled as (
    update public.notification_jobs j set
      state='cancelled',
      state_reason_code=coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'source_invalidated'),
      state_reason_detail=nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),
      state_actor_type='system',state_actor_id=null,
      lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,
      completed_at=coalesce(j.completed_at,clock_timestamp())
    from targets t
    where j.id=t.id
    returning j.notification_id
  )
  select count(*)::integer into v_count from cancelled;

  update public.notifications n set
    state='cancelled',
    state_reason_code=coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'source_invalidated'),
    state_reason_detail=nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),
    cancelled_at=coalesce(n.cancelled_at,clock_timestamp())
  where n.id in (
    select distinct nn.id
    from public.notifications nn
    join public.domain_events e
      on e.event_id=nn.source_event_id and e.studio_id=nn.studio_id
    where nn.studio_id=p_studio_id
      and (
        (e.source_entity_type=trim(p_source_entity_type) and e.source_entity_id=p_source_entity_id)
        or (
          trim(p_source_entity_type)='reservation'
          and (
            nn.recipient_snapshot->>'reservation_id'=p_source_entity_id::text
            or nn.template_variables->>'reservation_id'=p_source_entity_id::text
          )
        )
      )
  )
  and n.state='active';

  return v_count;
end;
$$;

create or replace function public.system_cancel_pending_notifications_for_session(
  p_studio_id uuid,p_session_id uuid,p_reason_code text,p_reason_detail text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  with target_notifications as (
    select distinct n.id
    from public.notifications n
    join public.domain_events e
      on e.event_id=n.source_event_id and e.studio_id=n.studio_id
    left join public.reservations r
      on e.source_entity_type='reservation'
     and r.id=e.source_entity_id and r.studio_id=e.studio_id
    where n.studio_id=p_studio_id
      and (
        e.payload->>'session_id'=p_session_id::text
        or (e.source_entity_type='reservation' and r.session_id=p_session_id)
        or (e.source_entity_type='class_session' and e.source_entity_id=p_session_id)
      )
  ),
  targets as (
    select j.id,j.notification_id
    from public.notification_jobs j
    join target_notifications tn on tn.id=j.notification_id
    where j.state in ('ready','scheduled','processing','retry_wait')
    for update of j
  ),
  cancelled as (
    update public.notification_jobs j set
      state='cancelled',
      state_reason_code=coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'session_rescheduled'),
      state_reason_detail=nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),
      state_actor_type='system',state_actor_id=null,
      lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,
      completed_at=coalesce(j.completed_at,clock_timestamp())
    from targets t
    where j.id=t.id
    returning j.notification_id
  )
  select count(*)::integer into v_count from cancelled;

  update public.notifications n set
    state='cancelled',
    state_reason_code=coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'session_rescheduled'),
    state_reason_detail=nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),
    cancelled_at=coalesce(n.cancelled_at,clock_timestamp())
  where n.id in (
    select distinct nn.id
    from public.notifications nn
    join public.domain_events e
      on e.event_id=nn.source_event_id and e.studio_id=nn.studio_id
    left join public.reservations r
      on e.source_entity_type='reservation'
     and r.id=e.source_entity_id and r.studio_id=e.studio_id
    where nn.studio_id=p_studio_id
      and (
        e.payload->>'session_id'=p_session_id::text
        or (e.source_entity_type='reservation' and r.session_id=p_session_id)
        or (e.source_entity_type='class_session' and e.source_entity_id=p_session_id)
      )
  )
  and n.state='active';

  return v_count;
end;
$$;

revoke all on function public.system_mark_notification_job_handed_off(uuid,text) from public,anon,authenticated;
revoke all on function public.system_fail_notification_job_handoff(uuid,text,text,text,integer) from public,anon,authenticated;

grant execute on function public.system_mark_notification_job_handed_off(uuid,text) to service_role;
grant execute on function public.system_fail_notification_job_handoff(uuid,text,text,text,integer) to service_role;
grant execute on function public.system_claim_notification_events(text,integer,integer) to service_role;
grant execute on function public.system_complete_notification_event(uuid,text,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.system_fail_notification_event(uuid,text,text,text,integer) to service_role;
grant execute on function public.system_claim_notification_jobs(text,integer,integer) to service_role;
grant execute on function public.system_cancel_notification_job(uuid,text,text) to service_role;
grant execute on function public.system_cancel_pending_notifications_for_source(uuid,text,uuid,text,text) to service_role;
grant execute on function public.system_cancel_pending_notifications_for_session(uuid,uuid,text,text) to service_role;
grant execute on function public.system_revalidate_notification_contact(uuid) to service_role;

commit;
