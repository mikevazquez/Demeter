do $$
declare
  v_studio_id uuid;
  v_studio_count integer;
  v_rule_count integer;
  v_confirmed_rule_id uuid;
  v_confirmed_current integer;
  v_confirmed_new integer;
begin
  select count(*) into v_studio_count
  from public.studios
  where lower(name) like 'demeter%';

  if v_studio_count <> 1 then
    raise exception 'demeter_studio_resolution_failed';
  end if;

  select id into v_studio_id
  from public.studios
  where lower(name) like 'demeter%'
  limit 1;

  select count(*) into v_rule_count
  from public.notification_rules
  where studio_id = v_studio_id
    and archived_at is null
    and rule_key in (
      'p0.booking.class_reminder_5h',
      'p0.booking.confirmed',
      'p0.booking.waitlist_promoted',
      'p0.session.rescheduled_reminder_5h'
    );

  if v_rule_count <> 4 then
    raise exception 'target_rule_set_incomplete';
  end if;

  if exists (
    select 1
    from public.notification_rules r
    join public.notification_rule_versions rv
      on rv.studio_id = r.studio_id
     and rv.rule_id = r.id
     and rv.version_number = r.current_version_number
    where r.studio_id = v_studio_id
      and r.rule_key in (
        'p0.booking.class_reminder_5h',
        'p0.session.rescheduled_reminder_5h'
      )
      and coalesce((rv.timing_config->>'minutes_before')::integer, -1) <> 300
  ) then
    raise exception 'reminder_timing_not_5h';
  end if;

  if exists (
    select 1
    from public.notification_rules r
    where r.studio_id = v_studio_id
      and r.rule_key in (
        'p0.booking.class_reminder_5h',
        'p0.booking.waitlist_promoted',
        'p0.session.rescheduled_reminder_5h'
      )
      and (
        select count(distinct rc.channel_key)
        from public.notification_rule_channels rc
        where rc.studio_id = r.studio_id
          and rc.rule_id = r.id
          and rc.version_number = r.current_version_number
          and rc.channel_key in ('push','inbox','whatsapp')
      ) <> 3
  ) then
    raise exception 'validated_channel_set_missing';
  end if;

  select id, current_version_number
    into v_confirmed_rule_id, v_confirmed_current
  from public.notification_rules
  where studio_id = v_studio_id
    and rule_key = 'p0.booking.confirmed'
    and archived_at is null
  limit 1;

  select coalesce(max(version_number), 0) + 1
    into v_confirmed_new
  from public.notification_rule_versions
  where studio_id = v_studio_id
    and rule_id = v_confirmed_rule_id;

  insert into public.notification_rule_versions (
    studio_id,
    rule_id,
    version_number,
    notification_type,
    priority,
    recipient_strategy_key,
    conditions,
    timing_strategy_key,
    timing_config,
    revalidation_strategy_key,
    template_key,
    expires_after_seconds,
    created_by_user_id,
    activated_at,
    communication_class
  )
  select
    studio_id,
    rule_id,
    v_confirmed_new,
    notification_type,
    priority,
    recipient_strategy_key,
    conditions,
    timing_strategy_key,
    timing_config,
    revalidation_strategy_key,
    template_key,
    expires_after_seconds,
    created_by_user_id,
    clock_timestamp(),
    communication_class
  from public.notification_rule_versions
  where studio_id = v_studio_id
    and rule_id = v_confirmed_rule_id
    and version_number = v_confirmed_current;

  insert into public.notification_rule_channels (
    studio_id,
    rule_id,
    version_number,
    channel_key,
    is_required,
    ordinal,
    channel_policy
  ) values
    (
      v_studio_id,
      v_confirmed_rule_id,
      v_confirmed_new,
      'push',
      true,
      0,
      jsonb_build_object(
        'body_template', 'Tu lugar quedó reservado. Consulta los detalles en Demeter Fitness',
        'title_template', 'Reserva confirmada',
        'delivery_max_attempts', 3
      )
    ),
    (
      v_studio_id,
      v_confirmed_rule_id,
      v_confirmed_new,
      'inbox',
      true,
      1,
      jsonb_build_object('delivery_max_attempts', 3)
    ),
    (
      v_studio_id,
      v_confirmed_rule_id,
      v_confirmed_new,
      'whatsapp',
      false,
      2,
      jsonb_build_object('delivery_max_attempts', 3)
    );

  update public.notification_rules
  set
    enabled = true,
    current_version_number = v_confirmed_new,
    updated_at = clock_timestamp()
  where studio_id = v_studio_id
    and id = v_confirmed_rule_id;

  update public.notification_rules
  set
    enabled = true,
    updated_at = clock_timestamp()
  where studio_id = v_studio_id
    and archived_at is null
    and rule_key in (
      'p0.booking.class_reminder_5h',
      'p0.booking.waitlist_promoted',
      'p0.session.rescheduled_reminder_5h'
    );
end;
$$;
