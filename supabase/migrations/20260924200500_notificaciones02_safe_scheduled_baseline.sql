-- NOTIFICACIONES-02 · Future-studio seeding and safe scheduled producer baselines.

create table if not exists private.notification_operational_activation_baselines (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  activated_at timestamptz not null default clock_timestamp()
);

revoke all on table private.notification_operational_activation_baselines
from public, anon, authenticated, service_role;

insert into private.notification_operational_activation_baselines(studio_id, activated_at)
select s.id, clock_timestamp()
from public.studios s
on conflict (studio_id) do nothing;

create or replace function private.notification02_seed_new_studio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_notification02_operational_catalog(new.id);

  update public.notification_rules
  set enabled = false,
      updated_at = clock_timestamp()
  where studio_id = new.id
    and rule_key in ('p0.booking.cancelled','p0.evaluation.scheduled')
    and archived_at is null;

  insert into private.notification_operational_activation_baselines(
    studio_id,
    activated_at
  )
  values (new.id, clock_timestamp())
  on conflict (studio_id) do nothing;

  return new;
end;
$$;

revoke all on function private.notification02_seed_new_studio()
from public, anon, authenticated, service_role;

drop trigger if exists zz_studios_seed_notification02_operational_catalog
on public.studios;

create trigger zz_studios_seed_notification02_operational_catalog
after insert on public.studios
for each row execute function private.notification02_seed_new_studio();

create or replace function private.notification_emit_due_operational_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_waitlist_expired integer := 0;
  v_package_expiring integer := 0;
  v_package_expired integer := 0;
  v_evaluation_reminders integer := 0;
  v_document_pending integer := 0;
begin
  update public.class_waitlist_entries w
  set status = 'expired',
      resolved_at = coalesce(w.resolved_at, clock_timestamp()),
      resolution_reason = coalesce(w.resolution_reason, 'session_no_longer_available'),
      updated_at = clock_timestamp()
  from public.class_sessions cs
  where w.session_id = cs.id
    and w.studio_id = cs.studio_id
    and w.status = 'active'
    and (cs.status <> 'scheduled' or cs.starts_at <= clock_timestamp());
  get diagnostics v_waitlist_expired = row_count;

  for v_row in
    select a.id, a.studio_id, a.student_id, a.expires_on, s.timezone
    from public.product_acquisitions a
    join public.studios s on s.id = a.studio_id
    where a.status = 'active'
      and a.refunded_at is null
      and a.expires_on is not null
      and a.expires_on = (
        (clock_timestamp() at time zone coalesce(s.timezone, 'America/Mexico_City'))::date + 3
      )
  loop
    if private.notification_try_emit_domain_event(
      v_row.studio_id,
      'package.expiring_due',
      'product_acquisition',
      v_row.id,
      'notification:package.expiring_due:' || v_row.id::text,
      jsonb_build_object(
        'student_id', v_row.student_id,
        'acquisition_id', v_row.id,
        'expires_on', v_row.expires_on,
        'days_before', 3
      ),
      null,
      clock_timestamp()
    ) is not null then
      v_package_expiring := v_package_expiring + 1;
    end if;
  end loop;

  for v_row in
    select a.id, a.studio_id, a.student_id, a.expires_on, s.timezone
    from public.product_acquisitions a
    join public.studios s on s.id = a.studio_id
    where a.status in ('active','expired')
      and a.refunded_at is null
      and a.expires_on is not null
      and a.expires_on = (
        (clock_timestamp() at time zone coalesce(s.timezone, 'America/Mexico_City'))::date - 1
      )
  loop
    if private.notification_try_emit_domain_event(
      v_row.studio_id,
      'package.expired_due',
      'product_acquisition',
      v_row.id,
      'notification:package.expired_due:' || v_row.id::text,
      jsonb_build_object(
        'student_id', v_row.student_id,
        'acquisition_id', v_row.id,
        'expires_on', v_row.expires_on
      ),
      null,
      clock_timestamp()
    ) is not null then
      v_package_expired := v_package_expired + 1;
    end if;
  end loop;

  for v_row in
    select
      ei.id,
      ei.studio_id,
      ei.student_id,
      r.id as reservation_id,
      r.session_id,
      cs.starts_at
    from public.evaluation_invitations ei
    join public.reservations r
      on r.id = ei.reservation_id
     and r.studio_id = ei.studio_id
    join public.class_sessions cs
      on cs.id = r.session_id
     and cs.studio_id = ei.studio_id
    where ei.status not in ('completed','declined')
      and ei.reservation_id is not null
      and r.status = 'reserved'
      and cs.status = 'scheduled'
      and cs.starts_at > clock_timestamp()
      and cs.starts_at <= clock_timestamp() + interval '24 hours'
  loop
    if private.notification_try_emit_domain_event(
      v_row.studio_id,
      'evaluation.reminder_due',
      'evaluation_invitation',
      v_row.id,
      'notification:evaluation.reminder_due:' || v_row.id::text,
      jsonb_build_object(
        'student_id', v_row.student_id,
        'invitation_id', v_row.id,
        'reservation_id', v_row.reservation_id,
        'session_id', v_row.session_id,
        'starts_at', v_row.starts_at
      ),
      null,
      clock_timestamp()
    ) is not null then
      v_evaluation_reminders := v_evaluation_reminders + 1;
    end if;
  end loop;

  for v_row in
    select
      dv.id as version_id,
      dv.document_id,
      dv.studio_id,
      dv.version_number,
      s.id as student_id,
      d.name as document_name
    from public.document_versions dv
    join public.studio_documents d on d.id = dv.document_id
    join public.students s
      on s.studio_id = dv.studio_id
     and s.active
     and s.lifecycle_status = 'active'
    join private.notification_operational_activation_baselines b
      on b.studio_id = dv.studio_id
    where dv.status = 'active'
      and dv.published_at is not null
      and dv.published_at >= b.activated_at
      and dv.published_at <= clock_timestamp() - interval '12 hours'
      and dv.retired_at is null
  loop
    if private.document_version_applies_to_student(
         v_row.version_id,
         v_row.student_id,
         null
       )
       and not private.document_requirement_satisfied(
         v_row.version_id,
         v_row.student_id
       ) then
      if private.notification_try_emit_domain_event(
        v_row.studio_id,
        'documents.pending',
        'document_version',
        v_row.version_id,
        'notification:documents.pending:' || v_row.version_id::text || ':' ||
          v_row.student_id::text,
        jsonb_build_object(
          'student_id', v_row.student_id,
          'document_id', v_row.document_id,
          'version_id', v_row.version_id,
          'version_number', v_row.version_number,
          'document_name', v_row.document_name
        ),
        null,
        clock_timestamp()
      ) is not null then
        v_document_pending := v_document_pending + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'waitlist_expired', v_waitlist_expired,
    'package_expiring', v_package_expiring,
    'package_expired', v_package_expired,
    'evaluation_reminders', v_evaluation_reminders,
    'documents_pending', v_document_pending
  );
end;
$$;

revoke all on function private.notification_emit_due_operational_events()
from public, anon, authenticated, service_role;

create or replace function private.notification_emit_due_package_activations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select
      a.id,
      a.studio_id,
      a.student_id,
      a.starts_on,
      a.expires_on
    from public.product_acquisitions a
    join public.studios s on s.id = a.studio_id
    where a.status = 'active'
      and a.refunded_at is null
      and a.starts_on = (
        clock_timestamp() at time zone coalesce(s.timezone, 'America/Mexico_City')
      )::date
  loop
    if private.notification_try_emit_domain_event(
      v_row.studio_id,
      'package.activated',
      'product_acquisition',
      v_row.id,
      'notification:package.activated:' || v_row.id::text,
      jsonb_build_object(
        'student_id', v_row.student_id,
        'acquisition_id', v_row.id,
        'starts_on', v_row.starts_on,
        'expires_on', v_row.expires_on
      ),
      null,
      clock_timestamp()
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.notification_emit_due_package_activations()
from public, anon, authenticated, service_role;
