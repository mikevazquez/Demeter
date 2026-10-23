-- Preserve reminder timing, templates, preferences and channels. No adapter changes.
create or replace function public.system_materialize_notification(
  p_studio_id uuid,p_source_event_id uuid,p_rule_id uuid,p_rule_version_number integer,
  p_notification_type text,p_communication_class text,p_recipient_type text,
  p_recipient_entity_id uuid,p_recipient_user_id uuid,p_recipient_snapshot jsonb,
  p_priority text,p_scheduled_for timestamptz,p_expires_at timestamptz,
  p_template_key text,p_template_variables jsonb,p_deduplication_key text,
  p_channels jsonb,p_suppressed boolean default false,p_reason_code text default null,
  p_reason_detail text default null
)
returns table(notification_id uuid, created boolean, jobs_created integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_notification_id uuid;
  v_created boolean := false;
  v_jobs_created integer := 0;
  v_channel jsonb;
  v_channel_key text;
  v_is_required boolean;
  v_max_attempts integer;
  v_scheduled_at timestamptz;
  v_person_id uuid;
  v_reminder boolean := false;
  v_reservation_id uuid;
  v_current_start timestamptz;
begin
  if p_communication_class not in ('P0','P1','P2') then raise exception 'notification_communication_class_invalid'; end if;
  if p_recipient_snapshot is null or jsonb_typeof(p_recipient_snapshot) <> 'object' then raise exception 'notification_recipient_snapshot_must_be_object'; end if;
  if p_template_variables is null or jsonb_typeof(p_template_variables) <> 'object' then raise exception 'notification_template_variables_must_be_object'; end if;
  if p_channels is null or jsonb_typeof(p_channels) <> 'array' then raise exception 'notification_channels_must_be_array'; end if;
  if not coalesce(p_suppressed,false) and jsonb_array_length(p_channels)=0 then raise exception 'notification_channels_required'; end if;

  if trim(coalesce(p_recipient_type,''))='student' and p_recipient_entity_id is not null then
    select s.person_id into v_person_id
    from public.students s
    where s.id=p_recipient_entity_id and s.studio_id=p_studio_id;
  end if;

  -- The two reminder rules describe one reservation at one current time.
  -- Lock the session against a concurrent reschedule and serialize the reminder.
  v_reminder := not coalesce(p_suppressed,false)
    and trim(p_notification_type)='class_reminder_5h'
    and trim(p_template_key)='class_reminder'
    and trim(p_recipient_type)='student'
    and p_recipient_entity_id is not null
    and coalesce(pg_catalog.pg_input_is_valid(p_template_variables->>'reservation_id','uuid'),false)
    and coalesce(pg_catalog.pg_input_is_valid(p_template_variables->>'session_starts_at','timestamp with time zone'),false);
  if v_reminder then
    v_reservation_id := (p_template_variables->>'reservation_id')::uuid;
    select cs.starts_at into v_current_start
    from public.reservations r
    join public.class_sessions cs on cs.id=r.session_id and cs.studio_id=r.studio_id
    where r.id=v_reservation_id and r.studio_id=p_studio_id
      and r.student_id=p_recipient_entity_id
    for share of cs;
    if not found or v_current_start is distinct from (p_template_variables->>'session_starts_at')::timestamptz then
      p_suppressed := true;
      p_reason_code := 'reminder_snapshot_obsolete';
      p_reason_detail := 'Reservation context no longer matches the current session time.';
    else
      perform pg_advisory_xact_lock(hashtextextended(
        'class-reminder:'||p_studio_id::text||':'||v_reservation_id::text||':'||p_recipient_entity_id::text,0));
      select n.id into v_notification_id
      from public.notifications n
      where n.studio_id=p_studio_id and n.state='active'
        and n.notification_type='class_reminder_5h' and n.template_key='class_reminder'
        and n.communication_class=p_communication_class and n.recipient_type='student'
        and n.recipient_entity_id=p_recipient_entity_id
        and n.recipient_user_id is not distinct from p_recipient_user_id
        and n.template_variables->>'reservation_id'=v_reservation_id::text
        and n.scheduled_for is not distinct from p_scheduled_for
        and case when pg_catalog.pg_input_is_valid(n.template_variables->>'session_starts_at','timestamp with time zone')
          then (n.template_variables->>'session_starts_at')::timestamptz=v_current_start else false end
      order by n.created_at,n.id limit 1
      for update;
    end if;
  end if;

  if v_notification_id is null then
    insert into public.notifications (
      studio_id,source_event_id,rule_id,rule_version_number,notification_type,communication_class,
      recipient_type,recipient_entity_id,recipient_user_id,recipient_snapshot,priority,state,
      scheduled_for,expires_at,template_key,template_variables,deduplication_key,state_reason_code,
      state_reason_detail,state_actor_type,suppressed_at
    ) values (
      p_studio_id,p_source_event_id,p_rule_id,p_rule_version_number,trim(p_notification_type),
      p_communication_class,trim(p_recipient_type),p_recipient_entity_id,p_recipient_user_id,
      p_recipient_snapshot,p_priority,case when coalesce(p_suppressed,false) then 'suppressed' else 'active' end,
      p_scheduled_for,p_expires_at,trim(p_template_key),p_template_variables,trim(p_deduplication_key),
      case when coalesce(p_suppressed,false) then coalesce(nullif(trim(coalesce(p_reason_code,'')),''),'suppressed') else 'created' end,
      nullif(left(trim(coalesce(p_reason_detail,'')),1000),''),'system',
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
  end if;

  if not coalesce(p_suppressed,false) then
    for v_channel in select value from jsonb_array_elements(p_channels)
    loop
      v_channel_key := nullif(trim(coalesce(v_channel->>'channel_key','')),'');
      if v_channel_key is null then raise exception 'notification_channel_key_required'; end if;
      if not exists(select 1 from public.notification_channels c where c.channel_key=v_channel_key and c.is_active) then
        raise exception 'notification_channel_inactive:%',v_channel_key;
      end if;

      if v_person_id is not null
         and v_channel_key in ('push','whatsapp','email')
         and not private.person_notification_channel_enabled(p_studio_id,v_person_id,v_channel_key) then
        continue;
      end if;

      -- Reusing a logical reminder preserves one job per configured channel.
      -- A later rule may add a missing channel, but never reopens an existing job.
      if v_reminder and exists (
        select 1 from public.notification_jobs j
        where j.studio_id=p_studio_id and j.notification_id=v_notification_id
          and j.channel_key=v_channel_key
      ) then continue; end if;

      v_is_required := coalesce((v_channel->>'is_required')::boolean,true);
      v_max_attempts := greatest(1,least(10,coalesce(nullif(v_channel#>>'{channel_policy,max_attempts}','')::integer,3)));
      v_scheduled_at := coalesce(p_scheduled_for,clock_timestamp());

      insert into public.notification_jobs (
        studio_id,notification_id,channel_key,is_required,state,scheduled_at,available_at,expires_at,
        max_attempts,channel_deduplication_key,state_reason_code,state_actor_type
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
$function$;

create or replace function public.system_cancel_pending_notifications_for_session(
  p_studio_id uuid,
  p_session_id uuid,
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
  with target_notifications as (
    select distinct n.id
    from public.notifications n
    join public.domain_events e
      on e.event_id = n.source_event_id
     and e.studio_id = n.studio_id
    join public.notification_rule_versions rv
      on rv.studio_id = n.studio_id
     and rv.rule_id = n.rule_id
     and rv.version_number = n.rule_version_number
    left join public.reservations r
      on e.source_entity_type = 'reservation'
     and r.id = e.source_entity_id
     and r.studio_id = e.studio_id
    where n.studio_id = p_studio_id
      and rv.timing_strategy_key = 'before_session_start'
      -- Replaying a reschedule must retain a reminder already at the new time.
      and not coalesce(
        p_reason_code='session_rescheduled'
        and n.notification_type='class_reminder_5h'
        and n.template_key='class_reminder'
        and case when pg_catalog.pg_input_is_valid(n.template_variables->>'session_starts_at','timestamp with time zone')
          then (n.template_variables->>'session_starts_at')::timestamptz=(
            select cs.starts_at from public.class_sessions cs
            where cs.id=p_session_id and cs.studio_id=p_studio_id
          ) else false end,
        false
      )
      and (
        e.payload->>'session_id' = p_session_id::text
        or (e.source_entity_type = 'reservation' and r.session_id = p_session_id)
        or (e.source_entity_type = 'class_session' and e.source_entity_id = p_session_id)
      )
  ),
  targets as (
    select j.id,j.notification_id
    from public.notification_jobs j
    join target_notifications tn on tn.id = j.notification_id
    where j.state in ('ready','scheduled','processing','retry_wait')
    for update of j
  ),
  cancelled as (
    update public.notification_jobs j
    set
      state = 'cancelled',
      state_reason_code = coalesce(
        nullif(trim(coalesce(p_reason_code, '')), ''),
        'session_rescheduled'
      ),
      state_reason_detail = nullif(left(trim(coalesce(p_reason_detail, '')), 1000), ''),
      state_actor_type = 'system',
      state_actor_id = null,
      lease_owner = null,
      lease_acquired_at = null,
      lease_expires_at = null,
      next_attempt_at = null,
      completed_at = coalesce(j.completed_at, clock_timestamp())
    from targets t
    where j.id = t.id
    returning j.notification_id
  )
  select count(*)::integer
    into v_count
  from cancelled;

  update public.notifications n
  set
    state = 'cancelled',
    state_reason_code = coalesce(
      nullif(trim(coalesce(p_reason_code, '')), ''),
      'session_rescheduled'
    ),
    state_reason_detail = nullif(left(trim(coalesce(p_reason_detail, '')), 1000), ''),
    cancelled_at = coalesce(n.cancelled_at, clock_timestamp())
  where n.id in (
    select distinct nn.id
    from public.notifications nn
    join public.domain_events e
      on e.event_id = nn.source_event_id
     and e.studio_id = nn.studio_id
    join public.notification_rule_versions rv
      on rv.studio_id = nn.studio_id
     and rv.rule_id = nn.rule_id
     and rv.version_number = nn.rule_version_number
    left join public.reservations r
      on e.source_entity_type = 'reservation'
     and r.id = e.source_entity_id
     and r.studio_id = e.studio_id
    where nn.studio_id = p_studio_id
      and rv.timing_strategy_key = 'before_session_start'
      -- Replaying a reschedule must retain a reminder already at the new time.
      and not coalesce(
        p_reason_code='session_rescheduled'
        and nn.notification_type='class_reminder_5h'
        and nn.template_key='class_reminder'
        and case when pg_catalog.pg_input_is_valid(nn.template_variables->>'session_starts_at','timestamp with time zone')
          then (nn.template_variables->>'session_starts_at')::timestamptz=(
            select cs.starts_at from public.class_sessions cs
            where cs.id=p_session_id and cs.studio_id=p_studio_id
          ) else false end,
        false
      )
      and (
        e.payload->>'session_id' = p_session_id::text
        or (e.source_entity_type = 'reservation' and r.session_id = p_session_id)
        or (e.source_entity_type = 'class_session' and e.source_entity_id = p_session_id)
      )
  )
  and n.state = 'active';

  return v_count;
end;
$$;

create index if not exists notifications_class_reminder_reservation_active_idx
on public.notifications(studio_id,recipient_entity_id,(template_variables->>'reservation_id'))
where state='active' and notification_type='class_reminder_5h' and recipient_type='student';
