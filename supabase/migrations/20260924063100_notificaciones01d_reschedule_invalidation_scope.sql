-- NOTIFICACIONES-01D · Reprogramming invalidates only session-relative scheduled notifications.
-- Immediate transactional messages (booking confirmation/cancellation, etc.) must not be
-- cancelled just because the session start time changed.

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

revoke all on function public.system_cancel_pending_notifications_for_session(
  uuid,uuid,text,text
)
from public, anon, authenticated;

grant execute on function public.system_cancel_pending_notifications_for_session(
  uuid,uuid,text,text
)
to service_role;
