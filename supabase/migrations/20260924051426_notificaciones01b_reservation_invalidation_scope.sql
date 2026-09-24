-- NOTIFICACIONES-01B · Reservation cancellation must also invalidate
-- reminders materialized from session-level events such as session.rescheduled.

create or replace function public.system_cancel_pending_notifications_for_source(
  p_studio_id uuid,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_reason_code text,
  p_reason_detail text default null
)
returns integer
language plpgsql
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
      and (
        (
          e.source_entity_type = trim(p_source_entity_type)
          and e.source_entity_id = p_source_entity_id
        )
        or (
          trim(p_source_entity_type) = 'reservation'
          and (
            n.recipient_snapshot->>'reservation_id' = p_source_entity_id::text
            or n.template_variables->>'reservation_id' = p_source_entity_id::text
          )
        )
      )
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
