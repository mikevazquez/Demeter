-- NOTIFICACIONES-01B · Session reschedule source event and reminder invalidation.

create or replace function private.emit_session_rescheduled_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.starts_at is not distinct from new.starts_at then
    return new;
  end if;

  perform public.emit_domain_event(
    p_studio_id => new.studio_id,
    p_event_type => 'session.rescheduled',
    p_source_entity_type => 'class_session',
    p_source_entity_id => new.id,
    p_deduplication_key =>
      'session.rescheduled:' ||
      new.id::text || ':' ||
      extract(epoch from old.starts_at)::bigint::text || ':' ||
      extract(epoch from new.starts_at)::bigint::text,
    p_occurred_at => clock_timestamp(),
    p_actor_user_id => auth.uid(),
    p_payload => jsonb_build_object(
      'session_id', new.id,
      'template_id', new.template_id,
      'old_starts_at', old.starts_at,
      'new_starts_at', new.starts_at,
      'old_ends_at', old.ends_at,
      'new_ends_at', new.ends_at,
      'status', new.status::text
    )
  );

  return new;
end;
$$;

revoke all on function private.emit_session_rescheduled_event()
from public, anon, authenticated;

drop trigger if exists notification_emit_session_rescheduled on public.class_sessions;

create trigger notification_emit_session_rescheduled
after update of starts_at on public.class_sessions
for each row
when (old.starts_at is distinct from new.starts_at)
execute function private.emit_session_rescheduled_event();

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
  with targets as (
    select j.id
    from public.notification_jobs j
    join public.notifications n
      on n.id = j.notification_id
     and n.studio_id = j.studio_id
    join public.domain_events e
      on e.event_id = n.source_event_id
     and e.studio_id = n.studio_id
    left join public.reservations r
      on e.source_entity_type = 'reservation'
     and r.id = e.source_entity_id
     and r.studio_id = e.studio_id
    where j.studio_id = p_studio_id
      and (
        e.payload->>'session_id' = p_session_id::text
        or (
          e.source_entity_type = 'reservation'
          and r.session_id = p_session_id
        )
        or (
          e.source_entity_type = 'class_session'
          and e.source_entity_id = p_session_id
        )
      )
      and j.state in ('pending','scheduled','retrying')
    for update of j
  )
  update public.notification_jobs j
  set
    state = 'cancelled',
    state_reason_code = coalesce(nullif(trim(coalesce(p_reason_code, '')), ''), 'session_rescheduled'),
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

revoke all on function public.system_cancel_pending_notifications_for_session(uuid,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.system_cancel_pending_notifications_for_session(uuid,uuid,text,text)
to service_role;
