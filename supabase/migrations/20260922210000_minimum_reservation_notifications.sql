-- CANCELACION-MIN-02 · Notificaciones internas y evaluación inmediata.

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_kind text not null check (recipient_kind in ('student','instructor')),
  student_id uuid references public.students(id) on delete cascade,
  instructor_id uuid references public.instructors(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete cascade,
  source_event_id uuid references public.domain_events(event_id) on delete restrict,
  notification_type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  deduplication_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (studio_id, deduplication_key)
);

create index if not exists app_notifications_user_created_idx
  on public.app_notifications(recipient_user_id, created_at desc);
create index if not exists app_notifications_session_idx
  on public.app_notifications(studio_id, session_id, created_at desc)
  where session_id is not null;

alter table public.app_notifications enable row level security;

drop policy if exists app_notifications_select on public.app_notifications;
create policy app_notifications_select
on public.app_notifications
for select
to authenticated
using (
  recipient_user_id = (select auth.uid())
  or private.has_capability(studio_id, 'schedule.write')
);

revoke all on table public.app_notifications from public, anon, authenticated;
grant select on table public.app_notifications to authenticated;

create or replace function public.mark_my_app_notification_read(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  update public.app_notifications
  set read_at = coalesce(read_at, clock_timestamp())
  where id = p_notification_id
    and recipient_user_id = (select auth.uid());

  if not found then
    raise exception 'notification_not_found';
  end if;
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
    and s.user_id is not null
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
  join public.studio_memberships sm
    on sm.studio_id = i.studio_id
   and sm.person_id = i.person_id
   and sm.role = 'instructor'
   and sm.active
  where i.id = v_session.instructor_id
    and i.studio_id = new.studio_id
    and i.status = 'active'
  on conflict (studio_id, deduplication_key) do nothing;

  return new;
end;
$$;

revoke all on function private.create_minimum_cancellation_notifications()
from public, anon, authenticated, service_role;

drop trigger if exists minimum_reservation_create_app_notifications on public.domain_events;
create trigger minimum_reservation_create_app_notifications
after insert on public.domain_events
for each row
when (new.event_type = 'session.minimum_cancelled')
execute function private.create_minimum_cancellation_notifications();

create or replace function private.minimum_reservation_evaluate_after_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'scheduled'
     and new.minimum_reservations_enabled
     and not new.minimum_override
     and new.minimum_review_status = 'pending'
     and new.minimum_review_at is not null
     and new.minimum_review_at <= clock_timestamp()
     and new.starts_at > clock_timestamp() then
    perform private.process_due_minimum_reservation_sessions(
      new.studio_id,
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function private.minimum_reservation_evaluate_after_schedule_change()
from public, anon, authenticated, service_role;

drop trigger if exists minimum_reservation_evaluate_after_schedule_change
on public.class_sessions;
create trigger minimum_reservation_evaluate_after_schedule_change
after insert or update of
  starts_at,
  template_id,
  minimum_reservations_enabled,
  minimum_reservations,
  minimum_review_minutes_before,
  minimum_override_allowed,
  minimum_override
on public.class_sessions
for each row
execute function private.minimum_reservation_evaluate_after_schedule_change();

comment on table public.app_notifications is
  'Studio Flow in-app notifications. CANCELACION-MIN-02 writes student and instructor notices for automatic session cancellations.';
