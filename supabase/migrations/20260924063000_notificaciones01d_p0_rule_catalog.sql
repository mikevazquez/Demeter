-- NOTIFICACIONES-01D · Default P0 operational rule catalog.
-- Seeds real transactional rules per studio and retires legacy dispatchers
-- only for flows now owned by NOTIFICACIONES-01B/01C.

create or replace function private.ensure_default_notification_rule(
  p_studio_id uuid,
  p_rule_key text,
  p_event_type text,
  p_notification_type text,
  p_priority text,
  p_recipient_strategy_key text,
  p_conditions jsonb,
  p_timing_strategy_key text,
  p_timing_config jsonb,
  p_revalidation_strategy_key text,
  p_template_key text,
  p_expires_after_seconds integer,
  p_channels jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_id uuid;
  v_channel jsonb;
begin
  if p_studio_id is null then
    raise exception 'notification_default_rule_studio_required';
  end if;

  insert into public.notification_rules (
    studio_id,
    rule_key,
    event_type,
    enabled,
    current_version_number
  ) values (
    p_studio_id,
    trim(p_rule_key),
    trim(p_event_type),
    true,
    1
  )
  on conflict (studio_id, rule_key) do nothing;

  select r.id
    into v_rule_id
  from public.notification_rules r
  where r.studio_id = p_studio_id
    and r.rule_key = trim(p_rule_key);

  if v_rule_id is null then
    raise exception 'notification_default_rule_seed_failed:%', p_rule_key;
  end if;

  insert into public.notification_rule_versions (
    studio_id,
    rule_id,
    version_number,
    notification_type,
    communication_class,
    priority,
    recipient_strategy_key,
    conditions,
    timing_strategy_key,
    timing_config,
    revalidation_strategy_key,
    template_key,
    expires_after_seconds,
    activated_at
  ) values (
    p_studio_id,
    v_rule_id,
    1,
    trim(p_notification_type),
    'P0',
    p_priority,
    trim(p_recipient_strategy_key),
    coalesce(p_conditions, '{}'::jsonb),
    trim(p_timing_strategy_key),
    coalesce(p_timing_config, '{}'::jsonb),
    nullif(trim(coalesce(p_revalidation_strategy_key, '')), ''),
    trim(p_template_key),
    p_expires_after_seconds,
    clock_timestamp()
  )
  on conflict (rule_id, version_number) do nothing;

  if p_channels is null or jsonb_typeof(p_channels) <> 'array' then
    raise exception 'notification_default_rule_channels_invalid:%', p_rule_key;
  end if;

  for v_channel in
    select value from jsonb_array_elements(p_channels)
  loop
    insert into public.notification_rule_channels (
      studio_id,
      rule_id,
      version_number,
      channel_key,
      is_required,
      ordinal,
      channel_policy
    ) values (
      p_studio_id,
      v_rule_id,
      1,
      v_channel->>'channel_key',
      coalesce((v_channel->>'is_required')::boolean, true),
      coalesce((v_channel->>'ordinal')::integer, 0),
      coalesce(v_channel->'channel_policy', '{}'::jsonb)
    )
    on conflict (rule_id, version_number, channel_key) do nothing;
  end loop;

  return v_rule_id;
end;
$$;

revoke all on function private.ensure_default_notification_rule(
  uuid,text,text,text,text,text,jsonb,text,jsonb,text,text,integer,jsonb
)
from public, anon, authenticated;

create or replace function private.seed_default_p0_notification_rules(
  p_studio_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_channels_transactional jsonb := '[
    {"channel_key":"push","is_required":true,"ordinal":0,"channel_policy":{"delivery_max_attempts":3}},
    {"channel_key":"inbox","is_required":true,"ordinal":1,"channel_policy":{"delivery_max_attempts":3}},
    {"channel_key":"whatsapp","is_required":false,"ordinal":2,"channel_policy":{"delivery_max_attempts":3}}
  ]'::jsonb;
  v_channels_app jsonb := '[
    {"channel_key":"push","is_required":true,"ordinal":0,"channel_policy":{"delivery_max_attempts":3}},
    {"channel_key":"inbox","is_required":true,"ordinal":1,"channel_policy":{"delivery_max_attempts":3}}
  ]'::jsonb;
  v_channels_inbox_only jsonb := '[
    {"channel_key":"inbox","is_required":true,"ordinal":0,"channel_policy":{"delivery_max_attempts":3}}
  ]'::jsonb;
begin
  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.confirmed',
    'booking.created',
    'reservation_confirmed',
    'normal',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','reservation.status','operator','eq','value','reserved'),
        jsonb_build_object('field','session.status','operator','eq','value','scheduled'),
        jsonb_build_object('field','student.active','operator','eq','value',true),
        jsonb_build_object('field','payload.source','operator','neq','value','waitlist')
      )
    ),
    'immediate',
    '{}'::jsonb,
    'reservation_active_session_active',
    'reservation_confirmed',
    21600,
    v_channels_transactional
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.waitlist_promoted',
    'booking.created',
    'waitlist_promoted',
    'critical',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','reservation.status','operator','eq','value','reserved'),
        jsonb_build_object('field','session.status','operator','eq','value','scheduled'),
        jsonb_build_object('field','student.active','operator','eq','value',true),
        jsonb_build_object('field','payload.source','operator','eq','value','waitlist'),
        jsonb_build_object('field','payload.waitlist_entry_id','operator','exists','value',true)
      )
    ),
    'immediate',
    '{}'::jsonb,
    'reservation_active_session_active',
    'waitlist_promoted',
    21600,
    v_channels_transactional
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.class_reminder_5h',
    'booking.created',
    'class_reminder_5h',
    'normal',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','reservation.status','operator','eq','value','reserved'),
        jsonb_build_object('field','session.status','operator','eq','value','scheduled'),
        jsonb_build_object('field','student.active','operator','eq','value',true),
        jsonb_build_object('field','student.lifecycle_status','operator','eq','value','active')
      )
    ),
    'before_session_start',
    jsonb_build_object('minutes_before',300,'late_policy','skip'),
    'reservation_active_session_active',
    'class_reminder',
    null,
    v_channels_transactional
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.booking.cancelled',
    'booking.cancelled',
    'reservation_cancelled',
    'normal',
    'reservation_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object(
          'field','payload.cancellation_reason','operator','neq',
          'value','Clase cancelada automáticamente: mínimo de reservas no alcanzado'
        ),
        jsonb_build_object(
          'field','payload.to_status','operator','in',
          'value',jsonb_build_array('cancelled_on_time','cancelled_late','cancelled_by_studio')
        )
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'reservation_cancelled',
    21600,
    v_channels_transactional
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.session.rescheduled_notice',
    'session.rescheduled',
    'class_rescheduled',
    'critical',
    'confirmed_session_students',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','session.status','operator','eq','value','scheduled')
      )
    ),
    'immediate',
    '{}'::jsonb,
    'session_active',
    'class_rescheduled',
    86400,
    v_channels_app
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.session.rescheduled_reminder_5h',
    'session.rescheduled',
    'class_reminder_5h',
    'normal',
    'confirmed_session_students',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','session.status','operator','eq','value','scheduled')
      )
    ),
    'before_session_start',
    jsonb_build_object('minutes_before',300,'late_policy','skip'),
    'session_active',
    'class_reminder',
    null,
    v_channels_transactional
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.session.minimum_cancelled_students',
    'session.minimum_cancelled',
    'session_minimum_cancelled_student',
    'critical',
    'minimum_cancelled_session_students',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','payload.reservations_cancelled','operator','gt','value',0)
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'class_cancelled_student',
    86400,
    v_channels_app
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.session.minimum_cancelled_coach',
    'session.minimum_cancelled',
    'session_minimum_cancelled_coach',
    'critical',
    'session_instructor',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','session.instructor_id','operator','exists','value',true)
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'class_cancelled_coach',
    86400,
    v_channels_transactional
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.evaluation.invitation',
    'evaluation.invitation.offered',
    'evaluation_invitation',
    'normal',
    'payload_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','payload.student_id','operator','exists','value',true),
        jsonb_build_object('field','student.active','operator','eq','value',true)
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'evaluation_invitation',
    604800,
    v_channels_app
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.evaluation.scheduled',
    'evaluation.scheduled',
    'evaluation_scheduled',
    'normal',
    'payload_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','payload.student_id','operator','exists','value',true),
        jsonb_build_object('field','student.active','operator','eq','value',true)
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'evaluation_scheduled',
    86400,
    v_channels_inbox_only
  );
  v_count := v_count + 1;

  perform private.ensure_default_notification_rule(
    p_studio_id,
    'p0.evaluation.completed',
    'evaluation.completed',
    'evaluation_completed',
    'normal',
    'payload_student',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('field','payload.student_id','operator','exists','value',true),
        jsonb_build_object('field','student.active','operator','eq','value',true)
      )
    ),
    'immediate',
    '{}'::jsonb,
    null,
    'evaluation_completed',
    604800,
    v_channels_app
  );
  v_count := v_count + 1;

  return v_count;
end;
$$;

revoke all on function private.seed_default_p0_notification_rules(uuid)
from public, anon, authenticated;

create or replace function private.seed_default_p0_notification_rules_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_default_p0_notification_rules(new.id);
  return new;
end;
$$;

revoke all on function private.seed_default_p0_notification_rules_trigger()
from public, anon, authenticated;

drop trigger if exists studios_seed_default_p0_notification_rules
on public.studios;

create trigger studios_seed_default_p0_notification_rules
after insert on public.studios
for each row
execute function private.seed_default_p0_notification_rules_trigger();

do $$
declare
  v_studio record;
begin
  for v_studio in
    select id from public.studios
  loop
    perform private.seed_default_p0_notification_rules(v_studio.id);
  end loop;
end $$;

-- Legacy outbound paths now replaced by the central notification engine.
drop trigger if exists sf175_dispatch_booking_created
on public.domain_events;

drop trigger if exists sf174_dispatch_booking_cancelled
on public.domain_events;

drop trigger if exists sf174_dispatch_waitlist_promoted
on public.domain_events;

drop trigger if exists sf_class_reminder_dispatch
on public.domain_events;

drop trigger if exists minimum_reservation_cancelled_dispatch
on public.domain_events;

drop trigger if exists minimum_reservation_create_app_notifications
on public.domain_events;
