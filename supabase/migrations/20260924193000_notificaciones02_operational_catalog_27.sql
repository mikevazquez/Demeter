-- NOTIFICACIONES-02 · Operational catalog completion
-- Connects the approved 27 business-facing processes to the central notification engine.

create or replace function private.notification_try_emit_domain_event(
  p_studio_id uuid,
  p_event_type text,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_deduplication_key text,
  p_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_occurred_at timestamptz default clock_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    return public.emit_domain_event(
      p_studio_id => p_studio_id,
      p_event_type => p_event_type,
      p_source_entity_type => p_source_entity_type,
      p_source_entity_id => p_source_entity_id,
      p_deduplication_key => p_deduplication_key,
      p_occurred_at => p_occurred_at,
      p_actor_user_id => p_actor_user_id,
      p_payload => coalesce(p_payload, '{}'::jsonb)
    );
  exception when others then
    return null;
  end;
end;
$$;

revoke all on function private.notification_try_emit_domain_event(
  uuid,text,text,uuid,text,jsonb,uuid,timestamptz
) from public, anon, authenticated, service_role;

create or replace function private.notification_emit_reservation_operational_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
begin
  if old.status = 'reserved'
     and new.status = 'reserved'
     and (
       old.session_id is distinct from new.session_id
       or old.acquisition_id is distinct from new.acquisition_id
       or old.student_package_id is distinct from new.student_package_id
     ) then
    perform private.notification_try_emit_domain_event(
      new.studio_id,
      'booking.updated',
      'reservation',
      new.id,
      'notification:booking.updated:' || new.id::text || ':' || md5(to_jsonb(new)::text),
      jsonb_build_object(
        'reservation_id', new.id,
        'session_id', new.session_id,
        'student_id', new.student_id,
        'acquisition_id', new.acquisition_id,
        'from_session_id', old.session_id,
        'from_acquisition_id', old.acquisition_id
      ),
      coalesce(new.cancelled_by, auth.uid()),
      clock_timestamp()
    );
  end if;

  if old.status is distinct from new.status
     and new.status = 'cancelled_by_studio'
     and new.student_id is not null then
    select * into v_session
    from public.class_sessions
    where id = new.session_id
      and studio_id = new.studio_id;

    if v_session.holiday_override_id is not null then
      perform private.notification_try_emit_domain_event(
        new.studio_id,
        'studio.closure_affected',
        'reservation',
        new.id,
        'notification:studio.closure:' || new.id::text,
        jsonb_build_object(
          'reservation_id', new.id,
          'session_id', new.session_id,
          'student_id', new.student_id,
          'cancellation_reason', new.cancellation_reason,
          'holiday_override_id', v_session.holiday_override_id
        ),
        coalesce(new.cancelled_by, auth.uid()),
        coalesce(new.cancelled_at, clock_timestamp())
      );
    elsif coalesce(new.cancellation_reason, '') <>
      'Clase cancelada automáticamente: mínimo de reservas no alcanzado' then
      perform private.notification_try_emit_domain_event(
        new.studio_id,
        'session.cancelled_by_studio',
        'reservation',
        new.id,
        'notification:session.cancelled_by_studio:' || new.id::text,
        jsonb_build_object(
          'reservation_id', new.id,
          'session_id', new.session_id,
          'student_id', new.student_id,
          'cancellation_reason', new.cancellation_reason
        ),
        coalesce(new.cancelled_by, auth.uid()),
        coalesce(new.cancelled_at, clock_timestamp())
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.notification_emit_reservation_operational_events()
from public, anon, authenticated, service_role;

drop trigger if exists notification_reservation_operational_events on public.reservations;
create trigger notification_reservation_operational_events
after update on public.reservations
for each row execute function private.notification_emit_reservation_operational_events();

create or replace function private.notification_emit_waitlist_expired()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
     and new.status = 'expired' then
    perform private.notification_try_emit_domain_event(
      new.studio_id,
      'waitlist.expired',
      'class_waitlist_entry',
      new.id,
      'notification:waitlist.expired:' || new.id::text,
      jsonb_build_object(
        'waitlist_entry_id', new.id,
        'session_id', new.session_id,
        'student_id', new.student_id,
        'resolution_reason', new.resolution_reason
      ),
      auth.uid(),
      coalesce(new.resolved_at, clock_timestamp())
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notification_emit_waitlist_expired()
from public, anon, authenticated, service_role;

drop trigger if exists notification_waitlist_expired on public.class_waitlist_entries;
create trigger notification_waitlist_expired
after update of status on public.class_waitlist_entries
for each row execute function private.notification_emit_waitlist_expired();

create or replace function private.notification_emit_account_linked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id is null and new.user_id is not null then
    perform private.notification_try_emit_domain_event(
      new.studio_id,
      'account.created',
      'student',
      new.id,
      'notification:account.created:' || new.id::text || ':' || new.user_id::text,
      jsonb_build_object(
        'student_id', new.id,
        'user_id', new.user_id
      ),
      auth.uid(),
      clock_timestamp()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notification_emit_account_linked()
from public, anon, authenticated, service_role;

drop trigger if exists notification_account_linked on public.students;
create trigger notification_account_linked
after update of user_id on public.students
for each row execute function private.notification_emit_account_linked();

create or replace function private.notification_emit_password_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
begin
  if old.must_change_password is distinct from new.must_change_password
     and new.must_change_password = true
     and old.must_change_password = false then
    for v_student in
      select s.id, s.studio_id
      from public.students s
      where s.user_id = new.id
        and s.lifecycle_status <> 'archived'
    loop
      perform private.notification_try_emit_domain_event(
        v_student.studio_id,
        'account.password_reset',
        'student',
        v_student.id,
        'notification:account.password_reset:' || v_student.id::text || ':' ||
          extract(epoch from clock_timestamp())::bigint::text,
        jsonb_build_object(
          'student_id', v_student.id,
          'user_id', new.id
        ),
        auth.uid(),
        clock_timestamp()
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.notification_emit_password_reset()
from public, anon, authenticated, service_role;

drop trigger if exists notification_password_reset on public.user_accounts;
create trigger notification_password_reset
after update of must_change_password on public.user_accounts
for each row execute function private.notification_emit_password_reset();

create or replace function private.notification_emit_guardian_signature_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    perform private.notification_try_emit_domain_event(
      new.studio_id,
      'documents.guardian_signature_pending',
      'guardian_document_invitation',
      new.id,
      'notification:guardian_signature_pending:' || new.id::text,
      jsonb_build_object(
        'student_id', new.student_id,
        'guardian_id', new.guardian_id,
        'invitation_id', new.id,
        'expires_at', new.expires_at
      ),
      new.created_by,
      new.created_at
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notification_emit_guardian_signature_pending()
from public, anon, authenticated, service_role;

drop trigger if exists notification_guardian_signature_pending
on public.guardian_document_invitations;
create trigger notification_guardian_signature_pending
after insert on public.guardian_document_invitations
for each row execute function private.notification_emit_guardian_signature_pending();

create or replace function private.notification_emit_document_new_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_document_name text;
begin
  if old.status is distinct from new.status
     and new.status = 'active' then
    select d.name into v_document_name
    from public.studio_documents d
    where d.id = new.document_id;

    for v_student in
      select s.id
      from public.students s
      where s.studio_id = new.studio_id
        and s.active
        and s.lifecycle_status = 'active'
    loop
      if private.document_version_applies_to_student(new.id, v_student.id, null) then
        perform private.notification_try_emit_domain_event(
          new.studio_id,
          'document.new_version',
          'document_version',
          new.id,
          'notification:document.new_version:' || new.id::text || ':' || v_student.id::text,
          jsonb_build_object(
            'student_id', v_student.id,
            'document_id', new.document_id,
            'version_id', new.id,
            'version_number', new.version_number,
            'document_name', v_document_name,
            'requires_reacceptance', new.requires_reacceptance
          ),
          new.published_by,
          coalesce(new.published_at, clock_timestamp())
        );
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.notification_emit_document_new_version()
from public, anon, authenticated, service_role;

drop trigger if exists notification_document_new_version on public.document_versions;
create trigger notification_document_new_version
after update of status on public.document_versions
for each row execute function private.notification_emit_document_new_version();

create or replace function private.notification_emit_session_coach_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.instructor_id is distinct from new.instructor_id
     and new.status = 'scheduled' then
    perform private.notification_try_emit_domain_event(
      new.studio_id,
      'session.coach_changed',
      'class_session',
      new.id,
      'notification:session.coach_changed:' || new.id::text || ':' ||
        coalesce(old.instructor_id::text, 'none') || ':' ||
        coalesce(new.instructor_id::text, 'none'),
      jsonb_build_object(
        'session_id', new.id,
        'old_instructor_id', old.instructor_id,
        'instructor_id', new.instructor_id,
        'starts_at', new.starts_at
      ),
      auth.uid(),
      clock_timestamp()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notification_emit_session_coach_changed()
from public, anon, authenticated, service_role;

drop trigger if exists notification_session_coach_changed on public.class_sessions;
create trigger notification_session_coach_changed
after update of instructor_id on public.class_sessions
for each row execute function private.notification_emit_session_coach_changed();

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
      and a.expires_on = ((clock_timestamp() at time zone
        coalesce(s.timezone, 'America/Mexico_City'))::date + 3)
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
      and a.expires_on < (clock_timestamp() at time zone
        coalesce(s.timezone, 'America/Mexico_City'))::date
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
        'reservation_id', null,
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
    where dv.status = 'active'
      and dv.published_at is not null
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

select cron.schedule(
  'studio_flow_notification_operational_due',
  '0 * * * *',
  'select private.notification_emit_due_operational_events();'
);

create or replace function private.notification_default_channels(
  p_title text,
  p_body text,
  p_url text default '/student',
  p_push boolean default true,
  p_inbox boolean default true
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(item order by (item->>'ordinal')::integer),
    '[]'::jsonb
  )
  from (
    select jsonb_build_object(
      'channel_key', 'push',
      'is_required', not p_inbox,
      'ordinal', 0,
      'channel_policy', jsonb_build_object(
        'delivery_max_attempts', 3,
        'title_template', p_title,
        'body_template', p_body,
        'url', p_url
      )
    ) as item
    where p_push
    union all
    select jsonb_build_object(
      'channel_key', 'inbox',
      'is_required', true,
      'ordinal', 1,
      'channel_policy', jsonb_build_object(
        'delivery_max_attempts', 3,
        'title_template', p_title,
        'body_template', p_body,
        'url', p_url
      )
    ) as item
    where p_inbox
  ) q;
$$;

revoke all on function private.notification_default_channels(text,text,text,boolean,boolean)
from public, anon, authenticated, service_role;

create or replace function private.seed_notification02_operational_catalog(
  p_studio_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.modified',
    'booking.updated',
    'reservation_modified',
    'normal',
    'reservation_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'reservation_modified',
    21600,
    private.notification_default_channels(
      'Reserva actualizada',
      'Se actualizó información de tu reserva. Revisa los detalles en Demeter.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.cancelled_by_student',
    'booking.cancelled',
    'reservation_cancelled_by_student',
    'normal',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object(
          'field','payload.to_status','operator','in',
          'value',jsonb_build_array('cancelled_on_time','cancelled_late')
        )
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'reservation_cancelled_by_student',
    21600,
    private.notification_default_channels(
      'Reserva cancelada',
      'Tu reserva quedó cancelada. Consulta el estado de tu crédito en Demeter.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.cancelled_late',
    'booking.cancelled',
    'late_cancellation',
    'normal',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','payload.to_status','operator','eq','value','cancelled_late')
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'late_cancellation',
    21600,
    private.notification_default_channels(
      'Cancelación tardía',
      'La reserva se canceló dentro de la ventana tardía y aplican las reglas correspondientes.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.attendance.no_show',
    'attendance.finalized',
    'attendance_no_show',
    'normal',
    'payload_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','payload.attendance_status','operator','eq','value','no_show')
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'attendance_no_show',
    86400,
    private.notification_default_channels(
      'Inasistencia registrada',
      'La clase cerró sin check-in y la reserva quedó registrada como no show.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.session.cancelled_by_studio',
    'session.cancelled_by_studio',
    'session_cancelled_by_studio',
    'critical',
    'reservation_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'session_cancelled_by_studio',
    86400,
    private.notification_default_channels(
      'Tu clase fue cancelada',
      'El estudio canceló esta clase. Revisa tu reserva y el estado de tu crédito.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.waitlist.expired',
    'waitlist.expired',
    'waitlist_expired',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'waitlist_expired',
    86400,
    private.notification_default_channels(
      'La oportunidad de lista de espera venció',
      'Ya no hay una oportunidad activa para esta clase. Puedes revisar otras opciones.',
      '/student/reservar'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.package.activated',
    'loyalty.changed',
    'package_activated',
    'normal',
    'payload_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','event.source_entity_type','operator','eq','value','product_acquisition'),
        jsonb_build_object('field','payload.status','operator','eq','value','active')
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'package_activated',
    86400,
    private.notification_default_channels(
      'Paquete activado',
      'Tu paquete ya está activo. Puedes consultar vigencia y créditos en Demeter.',
      '/student/paquete'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.package.expiring',
    'package.expiring_due',
    'package_expiring',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'package_expiring',
    86400,
    private.notification_default_channels(
      'Tu paquete está por vencer',
      'Tu paquete vence en 3 días. Revisa tus créditos y próximas clases.',
      '/student/paquete'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.package.expired',
    'package.expired_due',
    'package_expired',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'package_expired',
    86400,
    private.notification_default_channels(
      'Tu paquete venció',
      'La vigencia de tu paquete terminó. Consulta tus opciones en Demeter.',
      '/student/paquete'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.credit.restored',
    'booking.cancelled',
    'credit_restored',
    'normal',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object(
          'field','payload.to_status','operator','in',
          'value',jsonb_build_array('cancelled_on_time','cancelled_by_studio')
        ),
        jsonb_build_object('field','payload.credits_held','operator','gt','value',0)
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'credit_restored',
    86400,
    private.notification_default_channels(
      'Crédito restaurado',
      'El crédito de esta reserva fue devuelto a tu paquete.',
      '/student/paquete'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.payment.pending',
    'walkin.commercial_pending',
    'payment_pending',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'payment_pending',
    604800,
    private.notification_default_channels(
      'Pago pendiente',
      'Hay una operación pendiente de completar. Revisa los detalles con el estudio.',
      '/student'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.payment.confirmed',
    'payment.confirmed',
    'payment_confirmed',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'payment_confirmed',
    86400,
    private.notification_default_channels(
      'Pago confirmado',
      'Tu pago quedó registrado correctamente.',
      '/student/paquete'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.evaluation.reminder',
    'evaluation.reminder_due',
    'evaluation_reminder',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'evaluation_reminder',
    86400,
    private.notification_default_channels(
      'Tu evaluación es pronto',
      'Tienes una evaluación programada dentro de las próximas 24 horas.',
      '/student/evaluaciones'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.documents.pending',
    'documents.pending',
    'documents_pending',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'documents_pending',
    604800,
    private.notification_default_channels(
      'Tienes documentos pendientes',
      'Hay documentos obligatorios que todavía requieren tu atención.',
      '/student/documentos'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.document.new_version',
    'document.new_version',
    'document_new_version',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'document_new_version',
    604800,
    private.notification_default_channels(
      'Nueva versión de documento',
      'Se publicó una nueva versión de un documento del estudio. Revísala en Demeter.',
      '/student/documentos',
      true,
      false
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.guardian.signature_pending',
    'documents.guardian_signature_pending',
    'guardian_signature_pending',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'guardian_signature_pending',
    604800,
    private.notification_default_channels(
      'Firma del responsable pendiente',
      'Tu proceso tiene una firma pendiente de tu responsable.',
      '/student/documentos'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.account.created',
    'account.created',
    'account_created',
    'normal',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'account_created',
    604800,
    private.notification_default_channels(
      'Tu cuenta está lista',
      'Tu acceso a Demeter ya fue creado. Completa la activación para comenzar.',
      '/student'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.password.reset',
    'account.password_reset',
    'password_reset',
    'critical',
    'payload_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'password_reset',
    86400,
    private.notification_default_channels(
      'Acceso restablecido',
      'Se generó un nuevo acceso temporal para tu cuenta. Completa el cambio de contraseña.',
      '/login/student/activar'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.session.coach_changed',
    'session.coach_changed',
    'session_coach_changed',
    'normal',
    'confirmed_session_students',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    'session_active',
    'session_coach_changed',
    86400,
    private.notification_default_channels(
      'Cambio de coach',
      'Cambió el coach de una de tus próximas clases. Revisa los detalles.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.studio.closure',
    'studio.closure_affected',
    'studio_closure',
    'critical',
    'reservation_student',
    '{}'::jsonb,
    'immediate',
    '{}'::jsonb,
    null,
    'studio_closure',
    86400,
    private.notification_default_channels(
      'Cambio extraordinario en el estudio',
      'Una de tus clases fue afectada por un cierre o ajuste extraordinario del estudio.',
      '/student/mis-clases'
    )
  );
  v_count := v_count + 1;

  return v_count;
end;
$$;

revoke all on function private.seed_notification02_operational_catalog(uuid)
from public, anon, authenticated, service_role;

do $$
declare
  v_studio record;
begin
  for v_studio in select id from public.studios loop
    perform private.seed_notification02_operational_catalog(v_studio.id);
  end loop;
end $$;

update public.notification_rules
set enabled = false,
    updated_at = clock_timestamp()
where rule_key = 'p0.booking.cancelled'
  and archived_at is null;

create or replace function public.admin_set_notification_rules_enabled(
  p_studio_id uuid,
  p_rule_keys text[],
  p_enabled boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
    raise exception 'forbidden';
  end if;

  if p_rule_keys is null or cardinality(p_rule_keys) = 0 then
    raise exception 'notification_rule_keys_required';
  end if;

  if p_enabled = false and (
    'p0.session.minimum_cancelled_students' = any(p_rule_keys)
    or 'p0.session.minimum_cancelled_coach' = any(p_rule_keys)
    or 'p0.password.reset' = any(p_rule_keys)
    or 'p0.studio.closure' = any(p_rule_keys)
  ) then
    raise exception 'notification_process_essential';
  end if;

  update public.notification_rules
  set enabled = p_enabled,
      updated_by_user_id = auth.uid(),
      updated_at = clock_timestamp()
  where studio_id = p_studio_id
    and rule_key = any(p_rule_keys)
    and archived_at is null;

  get diagnostics v_count = row_count;

  if v_count <> cardinality(p_rule_keys) then
    raise exception 'notification_rule_set_incomplete';
  end if;

  return v_count;
end;
$$;

revoke all on function public.admin_set_notification_rules_enabled(uuid,text[],boolean)
from public, anon, authenticated;
grant execute on function public.admin_set_notification_rules_enabled(uuid,text[],boolean)
to authenticated;
