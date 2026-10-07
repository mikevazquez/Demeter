do $migration$
declare
  v_rule record;
  v_emoji text;
  v_title text;
  v_body text;
begin
  for v_rule in
    select r.id, v.template_key, rc.channel_policy
    from public.notification_rules r
    join public.notification_rule_versions v
      on v.studio_id = r.studio_id
     and v.rule_id = r.id
     and v.version_number = r.current_version_number
    join public.notification_rule_channels rc
      on rc.studio_id = r.studio_id
     and rc.rule_id = r.id
     and rc.version_number = r.current_version_number
     and rc.channel_key = 'push'
    where r.archived_at is null
  loop
    v_emoji := case v_rule.template_key
      when 'account_created' then '👋'
      when 'attendance_no_show' then '⚠️'
      when 'reservation_cancelled' then '❌'
      when 'reservation_cancelled_by_student' then '❌'
      when 'late_cancellation' then '⏰'
      when 'class_reminder' then '⏰'
      when 'reservation_confirmed' then '✅'
      when 'reservation_modified' then '📝'
      when 'waitlist_promoted' then '🎉'
      when 'credit_restored' then '🎁'
      when 'document_new_version' then '📄'
      when 'documents_pending' then '📝'
      when 'evaluation_completed' then '🏅'
      when 'evaluation_invitation' then '✨'
      when 'evaluation_reminder' then '📝'
      when 'evaluation_scheduled' then '📅'
      when 'guardian_signature_pending' then '✍️'
      when 'package_activated' then '🎉'
      when 'package_expired' then '⌛'
      when 'package_expiring' then '⏳'
      when 'password_reset' then '🔐'
      when 'payment_confirmed' then '✅'
      when 'payment_pending' then '💳'
      when 'session_cancelled_by_studio' then '📢'
      when 'session_coach_changed' then '👩‍🏫'
      when 'class_cancelled_coach' then '📢'
      when 'class_cancelled_student' then '❌'
      when 'class_rescheduled' then '🗓️'
      when 'studio_closure' then '📢'
      when 'waitlist_expired' then '⏳'
      else '📨'
    end;
    v_title := trim(coalesce(v_rule.channel_policy->>'title_template', ''));
    v_body := trim(coalesce(v_rule.channel_policy->>'body_template', ''));
    if v_title = '' or v_body = '' or v_title like v_emoji || '%' then
      continue;
    end if;
    perform private.clone_notification_rule_version(
      v_rule.id, 'push', null, 'set', v_emoji || ' ' || v_title, v_body, null
    );
  end loop;

  update public.notification_marketing_configs m
  set title_template = case m.marketing_key
        when 'inactive-students' then '💌 ' || m.title_template
        when 'package-renewal' then '⏳ ' || m.title_template
        when 'special-promotions' then '✨ ' || m.title_template
        when 'birthday' then '🎂 ' || m.title_template
        when 'challenges' then '🏆 ' || m.title_template
        when 'events' then '🎟️ ' || m.title_template
        when 'referrals' then '🤸 ' || m.title_template
        when 'package-recovery-1' then '💖 ' || m.title_template
        when 'package-recovery-2' then '🫶 ' || m.title_template
        else '📨 ' || m.title_template
      end,
      updated_at = clock_timestamp()
  where nullif(trim(m.title_template), '') is not null
    and left(trim(m.title_template), 1) not in ('💌', '⏳', '✨', '🎂', '🏆', '🎟️', '🤸', '💖', '🫶', '📨');
end;
$migration$;
