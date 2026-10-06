-- Restore WhatsApp reservation confirmations for studios using Meta WhatsApp.
-- Keeps notification history immutable by creating a new rule version.
-- The Meta adapter already attaches the per-reservation check-in QR when the
-- configured reservation_confirmed template is a QR template.

do $$
declare
  v_rule record;
  v_new_version integer;
  v_whatsapp_ordinal integer;
begin
  for v_rule in
    select
      r.studio_id,
      r.id as rule_id,
      r.current_version_number
    from public.notification_rules r
    join public.notification_studio_channel_providers p
      on p.studio_id = r.studio_id
     and p.channel_key = 'whatsapp'
     and p.provider_key = 'meta_whatsapp'
     and p.enabled
     and p.is_default
    where r.rule_key = 'p0.booking.confirmed'
      and r.enabled
      and r.archived_at is null
      and not exists (
        select 1
        from public.notification_rule_channels c
        where c.studio_id = r.studio_id
          and c.rule_id = r.id
          and c.version_number = r.current_version_number
          and c.channel_key = 'whatsapp'
      )
  loop
    select coalesce(max(version_number), 0) + 1
      into v_new_version
    from public.notification_rule_versions
    where studio_id = v_rule.studio_id
      and rule_id = v_rule.rule_id;

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
      v_new_version,
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
    where studio_id = v_rule.studio_id
      and rule_id = v_rule.rule_id
      and version_number = v_rule.current_version_number;

    insert into public.notification_rule_channels (
      studio_id,
      rule_id,
      version_number,
      channel_key,
      is_required,
      ordinal,
      channel_policy
    )
    select
      studio_id,
      rule_id,
      v_new_version,
      channel_key,
      is_required,
      ordinal,
      channel_policy
    from public.notification_rule_channels
    where studio_id = v_rule.studio_id
      and rule_id = v_rule.rule_id
      and version_number = v_rule.current_version_number;

    select coalesce(max(ordinal), -1) + 1
      into v_whatsapp_ordinal
    from public.notification_rule_channels
    where studio_id = v_rule.studio_id
      and rule_id = v_rule.rule_id
      and version_number = v_new_version;

    insert into public.notification_rule_channels (
      studio_id,
      rule_id,
      version_number,
      channel_key,
      is_required,
      ordinal,
      channel_policy
    ) values (
      v_rule.studio_id,
      v_rule.rule_id,
      v_new_version,
      'whatsapp',
      false,
      v_whatsapp_ordinal,
      jsonb_build_object('delivery_max_attempts', 3)
    );

    update public.notification_rules
    set
      current_version_number = v_new_version,
      updated_at = clock_timestamp()
    where studio_id = v_rule.studio_id
      and id = v_rule.rule_id;
  end loop;
end;
$$;
