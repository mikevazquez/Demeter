-- CANCELACION-MIN-03 · Notificaciones dirigidas por entidad.
-- Conserva el aviso aunque el coach o la alumna todavía no tengan acceso al portal.

alter table public.app_notifications
  alter column recipient_user_id drop not null;

alter table public.app_notifications
  drop constraint if exists app_notifications_recipient_identity_check,
  add constraint app_notifications_recipient_identity_check
    check (
      (recipient_kind = 'student' and student_id is not null)
      or (recipient_kind = 'instructor' and instructor_id is not null)
    );

drop policy if exists app_notifications_select on public.app_notifications;
create policy app_notifications_select
on public.app_notifications
for select
to authenticated
using (
  recipient_user_id = (select auth.uid())
  or (
    recipient_kind = 'student'
    and student_id is not null
    and private.is_current_student(student_id, studio_id)
  )
  or (
    recipient_kind = 'instructor'
    and instructor_id is not null
    and private.is_current_instructor_assignment(studio_id, instructor_id)
  )
  or private.has_capability(studio_id, 'schedule.write')
);

create or replace function public.mark_my_app_notification_read(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.app_notifications%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_notification
  from public.app_notifications
  where id = p_notification_id
  for update;

  if not found then
    raise exception 'notification_not_found';
  end if;

  if not (
    v_notification.recipient_user_id = (select auth.uid())
    or (
      v_notification.recipient_kind = 'student'
      and v_notification.student_id is not null
      and private.is_current_student(v_notification.student_id, v_notification.studio_id)
    )
    or (
      v_notification.recipient_kind = 'instructor'
      and v_notification.instructor_id is not null
      and private.is_current_instructor_assignment(
        v_notification.studio_id,
        v_notification.instructor_id
      )
    )
  ) then
    raise exception 'forbidden';
  end if;

  update public.app_notifications
  set read_at = coalesce(read_at, clock_timestamp())
  where id = v_notification.id;
end;
$$;

revoke all on function public.mark_my_app_notification_read(uuid)
from public, anon;
grant execute on function public.mark_my_app_notification_read(uuid)
to authenticated;

create or replace function private.create_minimum_cancellation_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_template_name text;
  v_timezone text;
  v_when text;
  v_minimum integer;
  v_reservations_at_review integer;
  v_credits_returned integer;
begin
  if new.event_type <> 'session.minimum_cancelled'
     or new.source_entity_type <> 'class_session' then
    return new;
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = new.source_entity_id
    and studio_id = new.studio_id;

  if not found then
    return new;
  end if;

  select ct.name
    into v_template_name
  from public.class_templates ct
  where ct.id = v_session.template_id
    and ct.studio_id = new.studio_id;

  select coalesce(s.timezone, 'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = new.studio_id;

  v_when := to_char(
    v_session.starts_at at time zone v_timezone,
    'DD/MM/YYYY HH24:MI'
  );
  v_minimum := coalesce((new.payload->>'minimum_required')::integer, v_session.minimum_reservations);
  v_reservations_at_review := coalesce(
    (new.payload->>'reservations_at_review')::integer,
    v_session.minimum_reservations_at_review,
    0
  );
  v_credits_returned := coalesce(
    (new.payload->>'credits_returned')::integer,
    v_session.minimum_credits_returned,
    0
  );

  insert into public.app_notifications (
    studio_id,
    recipient_user_id,
    recipient_kind,
    student_id,
    session_id,
    source_event_id,
    notification_type,
    title,
    body,
    payload,
    deduplication_key
  )
  select
    new.studio_id,
    s.user_id,
    'student',
    s.id,
    v_session.id,
    new.event_id,
    'session_minimum_cancelled',
    'Tu clase fue cancelada',
    format(
      '%s del %s se canceló porque no alcanzó el mínimo de reservas. Tu crédito fue restaurado cuando correspondía.',
      coalesce(v_template_name, 'Tu clase'),
      v_when
    ),
    jsonb_build_object(
      'session_id', v_session.id,
      'activity', coalesce(v_template_name, 'Clase'),
      'starts_at', v_session.starts_at,
      'minimum_required', v_minimum,
      'reservations_at_review', v_reservations_at_review,
      'credit_restored', not coalesce(pa.unlimited, false),
      'credits_returned_total', v_credits_returned,
      'reason', 'minimum_reservations_not_met'
    ),
    'minimum_cancelled:student:' || new.event_id::text || ':' || s.id::text
  from public.reservations r
  join public.students s
    on s.id = r.student_id
   and s.studio_id = r.studio_id
  left join public.product_acquisitions pa
    on pa.id = r.acquisition_id
  where r.session_id = v_session.id
    and r.studio_id = new.studio_id
    and r.status = 'cancelled_by_studio'
    and r.cancellation_reason = 'Clase cancelada automáticamente: mínimo de reservas no alcanzado'
  on conflict (studio_id, deduplication_key) do nothing;

  insert into public.app_notifications (
    studio_id,
    recipient_user_id,
    recipient_kind,
    instructor_id,
    session_id,
    source_event_id,
    notification_type,
    title,
    body,
    payload,
    deduplication_key
  )
  select
    new.studio_id,
    sm.user_id,
    'instructor',
    i.id,
    v_session.id,
    new.event_id,
    'session_minimum_cancelled',
    'Clase cancelada',
    format(
      '%s del %s fue cancelada por no alcanzar el mínimo de reservas. No necesitas asistir.',
      coalesce(v_template_name, 'La clase'),
      v_when
    ),
    jsonb_build_object(
      'session_id', v_session.id,
      'activity', coalesce(v_template_name, 'Clase'),
      'starts_at', v_session.starts_at,
      'minimum_required', v_minimum,
      'reservations_at_review', v_reservations_at_review,
      'reason', 'minimum_reservations_not_met'
    ),
    'minimum_cancelled:instructor:' || new.event_id::text || ':' || i.id::text
  from public.instructors i
  left join lateral (
    select membership.user_id
    from public.studio_memberships membership
    where membership.studio_id = i.studio_id
      and membership.person_id = i.person_id
      and membership.role = 'instructor'
      and membership.active
    order by membership.created_at asc
    limit 1
  ) sm on true
  where i.id = v_session.instructor_id
    and i.studio_id = new.studio_id
    and i.status = 'active'
  on conflict (studio_id, deduplication_key) do nothing;

  return new;
end;
$$;

revoke all on function private.create_minimum_cancellation_notifications()
from public, anon, authenticated, service_role;

comment on column public.app_notifications.recipient_user_id is
  'Optional portal user link. Student/instructor entity identity is canonical so notices survive access provisioning.';
