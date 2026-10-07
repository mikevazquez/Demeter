update public.notification_rules
set enabled=false
where rule_key='p0.booking.trial_reminder_24h';

do $$
declare
  v_studio_id uuid;
  v_channels jsonb := '[
    {"channel_key":"push","is_required":true,"ordinal":0,"channel_policy":{"delivery_max_attempts":3}},
    {"channel_key":"inbox","is_required":true,"ordinal":1,"channel_policy":{"delivery_max_attempts":3}},
    {"channel_key":"whatsapp","is_required":false,"ordinal":2,"channel_policy":{"delivery_max_attempts":3}}
  ]'::jsonb;
begin
  for v_studio_id in
    select studio_id from public.trial_booking_policies where enabled=true
  loop
    perform private.ensure_default_notification_rule(
      v_studio_id,
      'p0.booking.trial_paid_reminder_24h',
      'trial.payment_provisional',
      'trial_class_reminder_24h',
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
      jsonb_build_object('minutes_before',1440,'late_policy','skip'),
      'reservation_active_session_active',
      'class_reminder',
      null,
      v_channels
    );
  end loop;
end $$;
