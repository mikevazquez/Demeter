-- DEV-04D: enforce Notifications as a tenant entitlement across admin, runtime, Push and Rewards onboarding.

insert into public.capabilities(key,description)
values
  ('notifications.read','Ver configuración y reglas de notificaciones del estudio'),
  ('notifications.manage','Configurar notificaciones y comunicaciones del estudio')
on conflict(key) do update
set description=excluded.description;

insert into public.role_capabilities(role,capability_key)
values
  ('owner','notifications.read'),
  ('owner','notifications.manage'),
  ('admin','notifications.read'),
  ('admin','notifications.manage')
on conflict do nothing;

insert into public.saas_module_capabilities(capability_key,module_key)
values
  ('notifications.read','notifications'),
  ('notifications.manage','notifications')
on conflict(capability_key) do update
set module_key=excluded.module_key;

drop policy if exists automation_communication_settings_read on public.automation_communication_settings;
create policy automation_communication_settings_read
  on public.automation_communication_settings for select to authenticated
  using (private.has_capability(studio_id,'notifications.read'));
drop policy if exists automation_communication_settings_insert on public.automation_communication_settings;
create policy automation_communication_settings_insert
  on public.automation_communication_settings for insert to authenticated
  with check (private.has_capability(studio_id,'notifications.manage'));
drop policy if exists automation_communication_settings_update on public.automation_communication_settings;
create policy automation_communication_settings_update
  on public.automation_communication_settings for update to authenticated
  using (private.has_capability(studio_id,'notifications.manage'))
  with check (private.has_capability(studio_id,'notifications.manage'));

drop policy if exists notification_admin_settings_read on public.notification_admin_settings;
create policy notification_admin_settings_read
  on public.notification_admin_settings for select to authenticated
  using (private.has_capability(studio_id,'notifications.read'));
drop policy if exists notification_admin_settings_insert on public.notification_admin_settings;
create policy notification_admin_settings_insert
  on public.notification_admin_settings for insert to authenticated
  with check (private.has_capability(studio_id,'notifications.manage'));
drop policy if exists notification_admin_settings_update on public.notification_admin_settings;
create policy notification_admin_settings_update
  on public.notification_admin_settings for update to authenticated
  using (private.has_capability(studio_id,'notifications.manage'))
  with check (private.has_capability(studio_id,'notifications.manage'));

drop policy if exists notification_marketing_configs_read on public.notification_marketing_configs;
create policy notification_marketing_configs_read
  on public.notification_marketing_configs for select to authenticated
  using (private.has_capability(studio_id,'notifications.read'));
drop policy if exists notification_marketing_configs_insert on public.notification_marketing_configs;
create policy notification_marketing_configs_insert
  on public.notification_marketing_configs for insert to authenticated
  with check (private.has_capability(studio_id,'notifications.manage'));
drop policy if exists notification_marketing_configs_update on public.notification_marketing_configs;
create policy notification_marketing_configs_update
  on public.notification_marketing_configs for update to authenticated
  using (private.has_capability(studio_id,'notifications.manage'))
  with check (private.has_capability(studio_id,'notifications.manage'));

drop policy if exists app_notifications_select on public.app_notifications;
create policy app_notifications_select
  on public.app_notifications for select to authenticated
  using (
    private.studio_has_module(studio_id,'notifications')
    and (
      (recipient_user_id=(select auth.uid()) and private.is_studio_member(studio_id))
      or (recipient_kind='student' and student_id is not null and private.is_current_student(student_id,studio_id))
      or (recipient_kind='instructor' and instructor_id is not null and private.is_current_instructor_assignment(studio_id,instructor_id))
      or private.has_capability(studio_id,'schedule.write')
    )
  );

CREATE OR REPLACE FUNCTION private.reward_onboarding_try_unlock(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_onboarding public.reward_onboarding%rowtype;
  v_timezone text;
  v_activated_on date;
  v_created boolean := false;
  v_had_membership boolean := false;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'reward_onboarding_student_not_found';
  end if;

  insert into public.reward_onboarding(studio_id,student_id)
  values(v_student.studio_id,v_student.id)
  on conflict(studio_id,student_id) do nothing;

  select * into v_onboarding
  from public.reward_onboarding
  where studio_id = v_student.studio_id
    and student_id = v_student.id
  for update;

  if v_onboarding.access_unlocked_at is not null then
    return jsonb_build_object(
      'access_unlocked',true,
      'created',false,
      'method',v_onboarding.access_method
    );
  end if;

  if v_onboarding.documents_completed_at is null
     or v_onboarding.profile_completed_at is null
     or v_onboarding.app_installed_at is null
     or (
       private.studio_has_module(v_student.studio_id, 'notifications')
       and v_onboarding.notifications_enabled_at is null
     )
     or v_onboarding.first_reservation_at is null
     or v_onboarding.first_attendance_at is null then
    return jsonb_build_object(
      'access_unlocked',false,
      'created',false,
      'method',null
    );
  end if;

  select coalesce(s.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios s
  where s.id = v_student.studio_id;

  v_activated_on := (clock_timestamp() at time zone v_timezone)::date;

  select exists(
    select 1
    from public.reward_status_memberships m
    where m.studio_id = v_student.studio_id
      and m.student_id = v_student.id
  ) into v_had_membership;

  if not v_had_membership then
    insert into public.reward_status_memberships(
      studio_id,student_id,current_level_key,activated_on,level_effective_from
    )
    values(
      v_student.studio_id,
      v_student.id,
      null,
      v_activated_on,
      date_trunc('month',v_activated_on)::date
    )
    on conflict(studio_id,student_id) do nothing
    returning true into v_created;
  end if;

  update public.reward_onboarding
  set completed_at = coalesce(completed_at,now()),
      access_unlocked_at = coalesce(access_unlocked_at,now()),
      access_method = coalesce(access_method,'onboarding'),
      updated_at = now()
  where studio_id = v_student.studio_id
    and student_id = v_student.id;

  insert into public.reward_status_events(
    studio_id,student_id,period_start,event_type,
    from_level_key,to_level_key,details
  )
  values(
    v_student.studio_id,
    v_student.id,
    date_trunc('month',v_activated_on)::date,
    'access_unlocked',
    null,
    null,
    jsonb_build_object(
      'source','reward_onboarding',
      'existing_membership_preserved',v_had_membership,
      'documents_completed_at',v_onboarding.documents_completed_at,
      'profile_completed_at',v_onboarding.profile_completed_at,
      'app_installed_at',v_onboarding.app_installed_at,
      'notifications_enabled_at',v_onboarding.notifications_enabled_at,
      'first_reservation_at',v_onboarding.first_reservation_at,
      'first_attendance_at',v_onboarding.first_attendance_at
    )
  );

  return jsonb_build_object(
    'access_unlocked',true,
    'created',coalesce(v_created,false),
    'method','onboarding',
    'existing_membership_preserved',v_had_membership
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_notification_marketing_snapshot(p_studio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.has_capability(p_studio_id, 'notifications.read') then
    raise exception 'forbidden';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'marketing_key', c.marketing_key,
        'status', c.status,
        'audience_key', c.audience_key,
        'send_window', c.send_window,
        'push_enabled', c.push_enabled,
        'whatsapp_enabled', c.whatsapp_enabled,
        'email_enabled', c.email_enabled,
        'title_template', c.title_template,
        'body_template', c.body_template,
        'cta_label', c.cta_label,
        'cta_href', c.cta_href,
        'metadata', c.metadata,
        'updated_at', c.updated_at
      )
      order by c.marketing_key
    ),
    '[]'::jsonb
  )
  into v_result
  from public.notification_marketing_configs c
  where c.studio_id = p_studio_id;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_notification_rules_snapshot(p_studio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.has_capability(p_studio_id, 'notifications.read') then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'rules',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'rule_key', r.rule_key,
          'event_type', r.event_type,
          'enabled', r.enabled,
          'version_number', v.version_number,
          'notification_type', v.notification_type,
          'timing_strategy_key', v.timing_strategy_key,
          'timing_config', v.timing_config,
          'template_key', v.template_key,
          'channels', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'channel_key', rc.channel_key,
                'is_required', rc.is_required,
                'ordinal', rc.ordinal,
                'channel_policy', rc.channel_policy
              )
              order by rc.ordinal, rc.channel_key
            )
            from public.notification_rule_channels rc
            where rc.studio_id = r.studio_id
              and rc.rule_id = r.id
              and rc.version_number = v.version_number
          ), '[]'::jsonb)
        )
        order by r.rule_key
      )
      from public.notification_rules r
      join public.notification_rule_versions v
        on v.studio_id = r.studio_id
       and v.rule_id = r.id
       and v.version_number = r.current_version_number
      where r.studio_id = p_studio_id
        and r.archived_at is null
    ), '[]'::jsonb),
    'settings',
    coalesce((
      select jsonb_build_object(
        'push_enabled', s.push_enabled,
        'whatsapp_enabled', s.whatsapp_enabled,
        'email_enabled', s.email_enabled,
        'non_urgent_send_window', s.non_urgent_send_window,
        'marketing_weekly_limit', s.marketing_weekly_limit
      )
      from public.notification_admin_settings s
      where s.studio_id = p_studio_id
    ), jsonb_build_object(
      'push_enabled', true,
      'whatsapp_enabled', true,
      'email_enabled', false,
      'non_urgent_send_window', '08:00-21:00',
      'marketing_weekly_limit', 2
    ))
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_notification_marketing_config(p_studio_id uuid, p_marketing_key text, p_status text, p_audience_key text, p_send_window text, p_push_enabled boolean, p_whatsapp_enabled boolean, p_email_enabled boolean, p_title_template text, p_body_template text, p_cta_label text, p_cta_href text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text := trim(coalesce(p_marketing_key, ''));
  v_status text := trim(coalesce(p_status, 'draft'));
  v_audience text := trim(coalesce(p_audience_key, 'all_eligible'));
  v_window text := nullif(trim(coalesce(p_send_window, '')), '');
begin
  if not private.has_capability(p_studio_id, 'notifications.manage') then
    raise exception 'forbidden';
  end if;

  if v_key = '' then
    raise exception 'marketing_key_required';
  end if;

  if v_status not in ('draft','active','paused') then
    raise exception 'marketing_status_invalid';
  end if;

  if v_audience not in (
    'all_eligible',
    'active_students',
    'inactive_students',
    'package_expiring',
    'package_expired',
    'trial_no_purchase'
  ) then
    raise exception 'marketing_audience_invalid';
  end if;

  if v_window is not null then
    perform private.assert_automation_send_window(v_window);
  end if;

  insert into public.notification_marketing_configs (
    studio_id,
    marketing_key,
    status,
    audience_key,
    send_window,
    push_enabled,
    whatsapp_enabled,
    email_enabled,
    title_template,
    body_template,
    cta_label,
    cta_href,
    updated_by_user_id,
    updated_at
  ) values (
    p_studio_id,
    v_key,
    v_status,
    v_audience,
    v_window,
    coalesce(p_push_enabled, false),
    coalesce(p_whatsapp_enabled, false),
    coalesce(p_email_enabled, false),
    nullif(trim(coalesce(p_title_template, '')), ''),
    nullif(trim(coalesce(p_body_template, '')), ''),
    nullif(trim(coalesce(p_cta_label, '')), ''),
    nullif(trim(coalesce(p_cta_href, '')), ''),
    auth.uid(),
    clock_timestamp()
  )
  on conflict (studio_id, marketing_key) do update
  set status = excluded.status,
      audience_key = excluded.audience_key,
      send_window = excluded.send_window,
      push_enabled = excluded.push_enabled,
      whatsapp_enabled = excluded.whatsapp_enabled,
      email_enabled = excluded.email_enabled,
      title_template = excluded.title_template,
      body_template = excluded.body_template,
      cta_label = excluded.cta_label,
      cta_href = excluded.cta_href,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_notification_settings(p_studio_id uuid, p_push_enabled boolean, p_whatsapp_enabled boolean, p_email_enabled boolean, p_non_urgent_send_window text, p_marketing_weekly_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_window text := nullif(trim(coalesce(p_non_urgent_send_window, '')), '');
begin
  if not private.has_capability(p_studio_id, 'notifications.manage') then
    raise exception 'forbidden';
  end if;

  if v_window is not null then
    perform private.assert_automation_send_window(v_window);
  end if;

  if p_marketing_weekly_limit is null
     or p_marketing_weekly_limit < 1
     or p_marketing_weekly_limit > 14 then
    raise exception 'notification_marketing_limit_invalid';
  end if;

  insert into public.notification_admin_settings (
    studio_id,
    push_enabled,
    whatsapp_enabled,
    email_enabled,
    non_urgent_send_window,
    marketing_weekly_limit,
    updated_by_user_id,
    updated_at
  ) values (
    p_studio_id,
    coalesce(p_push_enabled, false),
    coalesce(p_whatsapp_enabled, false),
    coalesce(p_email_enabled, false),
    v_window,
    p_marketing_weekly_limit,
    auth.uid(),
    clock_timestamp()
  )
  on conflict (studio_id) do update
  set push_enabled = excluded.push_enabled,
      whatsapp_enabled = excluded.whatsapp_enabled,
      email_enabled = excluded.email_enabled,
      non_urgent_send_window = excluded.non_urgent_send_window,
      marketing_weekly_limit = excluded.marketing_weekly_limit,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at;

  insert into public.automation_communication_settings (
    studio_id,
    global_send_window,
    updated_by_user_id,
    updated_at
  ) values (
    p_studio_id,
    v_window,
    auth.uid(),
    clock_timestamp()
  )
  on conflict (studio_id) do update
  set global_send_window = excluded.global_send_window,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at;

  update public.notification_contact_policies
  set max_per_7d = p_marketing_weekly_limit,
      updated_at = clock_timestamp()
  where studio_id = p_studio_id
    and communication_class = 'P2';

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_notification_rules_channel(p_studio_id uuid, p_rule_keys text[], p_channel_key text, p_enabled boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule record;
  v_count integer := 0;
begin
  if not private.has_capability(p_studio_id, 'notifications.manage') then
    raise exception 'forbidden';
  end if;

  if p_channel_key not in ('push','whatsapp','email') then
    raise exception 'notification_channel_not_manageable';
  end if;

  if p_rule_keys is null or cardinality(p_rule_keys) = 0 then
    raise exception 'notification_rule_keys_required';
  end if;

  if (
    select count(*)
    from public.notification_rules
    where studio_id = p_studio_id
      and rule_key = any(p_rule_keys)
      and archived_at is null
  ) <> cardinality(p_rule_keys) then
    raise exception 'notification_rule_set_incomplete';
  end if;

  for v_rule in
    select id
    from public.notification_rules
    where studio_id = p_studio_id
      and rule_key = any(p_rule_keys)
      and archived_at is null
    order by rule_key
  loop
    perform private.clone_notification_rule_version(
      v_rule.id,
      p_channel_key,
      p_enabled,
      'none',
      null,
      null,
      null
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_notification_rules_enabled(p_studio_id uuid, p_rule_keys text[], p_enabled boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if not private.has_capability(p_studio_id, 'notifications.manage') then
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_notification_rules_lead_time(p_studio_id uuid, p_rule_keys text[], p_minutes_before integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule record;
  v_count integer := 0;
begin
  if not private.has_capability(p_studio_id, 'notifications.manage') then
    raise exception 'forbidden';
  end if;

  if p_minutes_before is null or p_minutes_before < 0 or p_minutes_before > 10080 then
    raise exception 'notification_timing_out_of_range';
  end if;

  if p_rule_keys is null or cardinality(p_rule_keys) = 0 then
    raise exception 'notification_rule_keys_required';
  end if;

  if (
    select count(*)
    from public.notification_rules
    where studio_id = p_studio_id
      and rule_key = any(p_rule_keys)
      and archived_at is null
  ) <> cardinality(p_rule_keys) then
    raise exception 'notification_rule_set_incomplete';
  end if;

  for v_rule in
    select id
    from public.notification_rules
    where studio_id = p_studio_id
      and rule_key = any(p_rule_keys)
      and archived_at is null
    order by rule_key
  loop
    perform private.clone_notification_rule_version(
      v_rule.id,
      null,
      null,
      'none',
      null,
      null,
      p_minutes_before
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_notification_rules_message(p_studio_id uuid, p_rule_keys text[], p_channel_key text, p_title_template text, p_body_template text, p_reset boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule record;
  v_count integer := 0;
begin
  if not private.has_capability(p_studio_id, 'notifications.manage') then
    raise exception 'forbidden';
  end if;

  if p_channel_key not in ('push','email','inbox') then
    raise exception 'notification_channel_message_provider_managed';
  end if;

  if p_rule_keys is null or cardinality(p_rule_keys) = 0 then
    raise exception 'notification_rule_keys_required';
  end if;

  if (
    select count(*)
    from public.notification_rules
    where studio_id = p_studio_id
      and rule_key = any(p_rule_keys)
      and archived_at is null
  ) <> cardinality(p_rule_keys) then
    raise exception 'notification_rule_set_incomplete';
  end if;

  for v_rule in
    select id
    from public.notification_rules
    where studio_id = p_studio_id
      and rule_key = any(p_rule_keys)
      and archived_at is null
    order by rule_key
  loop
    perform private.clone_notification_rule_version(
      v_rule.id,
      p_channel_key,
      null,
      case when p_reset then 'reset' else 'set' end,
      p_title_template,
      p_body_template,
      null
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_push_notification_status(p_studio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
  v_configured boolean;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if not private.is_studio_member(p_studio_id) then
    raise exception 'push_membership_required';
  end if;

  if not private.studio_has_module(p_studio_id, 'notifications') then
    raise exception 'notifications_module_disabled';
  end if;

  select count(*)::integer
    into v_count
  from public.push_subscriptions ps
  where ps.studio_id = p_studio_id
    and ps.user_id = v_user_id
    and ps.revoked_at is null;

  select exists (
    select 1
    from vault.decrypted_secrets s
    where s.name in (
      'web_push_vapid_public_key:v1',
      'web_push_vapid_private_key:v1',
      'web_push_vapid_subject:v1'
    )
    group by 1
    having count(*) = 3
  )
  into v_configured;

  return jsonb_build_object(
    'configured', coalesce(v_configured, false),
    'active_subscriptions', coalesce(v_count, 0)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_my_push_subscription(p_studio_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text, p_device_label text DEFAULT NULL::text, p_expiration_time bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_id uuid;
  v_endpoint text := trim(coalesce(p_endpoint, ''));
  v_host text;
  v_p256dh text := trim(coalesce(p_p256dh, ''));
  v_auth text := trim(coalesce(p_auth, ''));
  v_user_agent text := nullif(trim(coalesce(p_user_agent, '')), '');
  v_device_label text := nullif(trim(coalesce(p_device_label, '')), '');
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if not private.is_studio_member(p_studio_id) then
    raise exception 'push_membership_required';
  end if;

  if not private.studio_has_module(p_studio_id, 'notifications') then
    raise exception 'notifications_module_disabled';
  end if;

  select sm.role::text
    into v_role
  from public.studio_memberships sm
  where sm.studio_id = p_studio_id
    and sm.user_id = v_user_id
    and sm.active
  limit 1;

  if v_role is null then
    raise exception 'push_membership_required';
  end if;

  if v_endpoint !~ '^https://[^[:space:]]+$' or length(v_endpoint) > 2048 then
    raise exception 'push_endpoint_invalid';
  end if;

  v_host := lower(substring(v_endpoint from '^https://([^/:]+)'));

  if v_host is null
     or not (
       v_host = 'fcm.googleapis.com'
       or v_host = 'push.services.mozilla.com'
       or v_host like '%.push.services.mozilla.com'
       or v_host = 'push.apple.com'
       or v_host like '%.push.apple.com'
     ) then
    raise exception 'push_endpoint_host_not_allowed';
  end if;

  if v_p256dh !~ '^[A-Za-z0-9_-]+$' or length(v_p256dh) not between 40 and 256 then
    raise exception 'push_p256dh_invalid';
  end if;

  if v_auth !~ '^[A-Za-z0-9_-]+$' or length(v_auth) not between 10 and 128 then
    raise exception 'push_auth_invalid';
  end if;

  if v_user_agent is not null and length(v_user_agent) > 1000 then
    raise exception 'push_user_agent_too_long';
  end if;

  if v_device_label is not null and length(v_device_label) > 160 then
    raise exception 'push_device_label_too_long';
  end if;

  insert into public.push_subscriptions (
    studio_id,user_id,role_key,endpoint,p256dh,auth_secret,expiration_time,
    user_agent,device_label,created_at,updated_at,last_seen_at,revoked_at
  ) values (
    p_studio_id,v_user_id,v_role,v_endpoint,v_p256dh,v_auth,p_expiration_time,
    v_user_agent,v_device_label,clock_timestamp(),clock_timestamp(),clock_timestamp(),null
  )
  on conflict (studio_id, endpoint)
  do update set
    user_id = excluded.user_id,
    role_key = excluded.role_key,
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    expiration_time = excluded.expiration_time,
    user_agent = excluded.user_agent,
    device_label = excluded.device_label,
    updated_at = clock_timestamp(),
    last_seen_at = clock_timestamp(),
    revoked_at = null
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.service_get_notification_rules_for_event(p_studio_id uuid, p_event_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rule_id', r.id,
        'rule_key', r.rule_key,
        'event_type', r.event_type,
        'version_number', v.version_number,
        'notification_type', v.notification_type,
        'communication_class', v.communication_class,
        'priority', v.priority,
        'recipient_strategy_key', v.recipient_strategy_key,
        'conditions', v.conditions,
        'timing_strategy_key', v.timing_strategy_key,
        'timing_config', v.timing_config,
        'revalidation_strategy_key', v.revalidation_strategy_key,
        'template_key', v.template_key,
        'expires_after_seconds', v.expires_after_seconds,
        'channels', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'channel_key', c.channel_key,
              'is_required', rc.is_required,
              'ordinal', rc.ordinal,
              'channel_policy', rc.channel_policy
            )
            order by rc.ordinal, rc.channel_key
          )
          from public.notification_rule_channels rc
          join public.notification_channels c
            on c.channel_key = rc.channel_key
           and c.is_active
          left join public.notification_admin_settings settings
            on settings.studio_id = r.studio_id
          where rc.studio_id = r.studio_id
            and rc.rule_id = r.id
            and rc.version_number = v.version_number
            and (
              c.channel_key = 'inbox'
              or (c.channel_key = 'push' and coalesce(settings.push_enabled, true))
              or (c.channel_key = 'whatsapp' and coalesce(settings.whatsapp_enabled, true))
              or (c.channel_key = 'email' and coalesce(settings.email_enabled, false))
            )
        ), '[]'::jsonb)
      )
      order by r.rule_key
    ),
    '[]'::jsonb
  )
  from public.notification_rules r
  join public.notification_rule_versions v
    on v.studio_id = r.studio_id
   and v.rule_id = r.id
   and v.version_number = r.current_version_number
  where r.studio_id = p_studio_id
    and private.studio_has_module(p_studio_id, 'notifications')
    and r.event_type = trim(p_event_type)
    and r.enabled
    and r.archived_at is null
    and v.activated_at is not null;
$function$;

CREATE OR REPLACE FUNCTION public.service_notification_channel_allowed(p_studio_id uuid, p_recipient_type text, p_recipient_entity_id uuid, p_channel_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_person_id uuid;
  v_channel text := lower(trim(coalesce(p_channel_key,'')));
begin
  if not private.studio_has_module(p_studio_id, 'notifications') then
    return false;
  end if;
  if v_channel not in ('push','whatsapp','email') then
    return true;
  end if;

  if trim(coalesce(p_recipient_type,'')) <> 'student'
     or p_recipient_entity_id is null then
    return true;
  end if;

  select s.person_id
    into v_person_id
  from public.students s
  where s.id=p_recipient_entity_id
    and s.studio_id=p_studio_id;

  if v_person_id is null then
    return true;
  end if;

  return private.person_notification_channel_enabled(
    p_studio_id,
    v_person_id,
    v_channel
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_get_notification_channel_preferences()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_pref public.person_notification_channel_preferences%rowtype;
  v_requested_studio uuid := private.requested_studio_id();
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if v_requested_studio is null then raise exception 'studio_context_required'; end if;

  if not private.studio_has_module(v_requested_studio, 'notifications') then
    raise exception 'notifications_module_disabled';
  end if;

  select * into v_student
  from public.students s
  where s.user_id=v_uid
    and s.studio_id=v_requested_studio
    and private.is_current_student(s.id,s.studio_id)
  limit 1;

  if not found or v_student.person_id is null then raise exception 'student_context_not_found'; end if;

  select * into v_pref
  from public.person_notification_channel_preferences p
  where p.studio_id=v_student.studio_id and p.person_id=v_student.person_id;

  return jsonb_build_object(
    'push_enabled',
      coalesce(
        v_pref.push_enabled,
        exists(
          select 1
          from public.push_subscriptions ps
          where ps.studio_id=v_student.studio_id
            and ps.user_id=v_uid
            and ps.revoked_at is null
        )
      ),
    'whatsapp_enabled', coalesce(v_pref.whatsapp_enabled,true),
    'email_enabled', coalesce(v_pref.email_enabled,false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_set_notification_channel_preference(p_channel_key text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_pref public.person_notification_channel_preferences%rowtype;
  v_channel text := lower(trim(coalesce(p_channel_key, '')));
  v_requested_studio uuid := private.requested_studio_id();
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  if v_requested_studio is null then
    raise exception 'studio_context_required';
  end if;

  if not private.studio_has_module(v_requested_studio, 'notifications') then
    raise exception 'notifications_module_disabled';
  end if;

  if v_channel not in ('push','whatsapp','email') then
    raise exception 'notification_channel_invalid';
  end if;

  select *
    into v_student
  from public.students s
  where s.user_id = v_uid
    and s.studio_id = v_requested_studio
    and private.is_current_student(s.id,s.studio_id)
  limit 1;

  if not found or v_student.person_id is null then
    raise exception 'student_context_not_found';
  end if;

  insert into public.person_notification_channel_preferences (
    studio_id,
    person_id,
    push_enabled,
    whatsapp_enabled,
    email_enabled,
    updated_by_user_id,
    updated_at
  )
  values (
    v_student.studio_id,
    v_student.person_id,
    case when v_channel = 'push' then p_enabled else true end,
    case when v_channel = 'whatsapp' then p_enabled else true end,
    case when v_channel = 'email' then p_enabled else true end,
    v_uid,
    clock_timestamp()
  )
  on conflict (studio_id, person_id)
  do update set
    push_enabled = case
      when v_channel = 'push' then excluded.push_enabled
      else public.person_notification_channel_preferences.push_enabled
    end,
    whatsapp_enabled = case
      when v_channel = 'whatsapp' then excluded.whatsapp_enabled
      else public.person_notification_channel_preferences.whatsapp_enabled
    end,
    email_enabled = case
      when v_channel = 'email' then excluded.email_enabled
      else public.person_notification_channel_preferences.email_enabled
    end,
    updated_by_user_id = v_uid,
    updated_at = clock_timestamp()
  returning *
    into v_pref;

  return jsonb_build_object(
    'push_enabled', v_pref.push_enabled,
    'whatsapp_enabled', v_pref.whatsapp_enabled,
    'email_enabled', v_pref.email_enabled
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.system_claim_notification_deliveries(p_worker_id text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60)
 RETURNS TABLE(delivery_id uuid, studio_id uuid, job_id uuid, notification_id uuid, channel_key text, adapter_key text, attempt_count integer, max_attempts integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if trim(coalesce(p_worker_id, '')) = '' then
    raise exception 'notification_delivery_worker_id_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'notification_delivery_claim_limit_invalid';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'notification_delivery_lease_invalid';
  end if;

  perform private.reconcile_stale_notification_delivery_attempts();

  update public.notification_deliveries d
  set
    state = 'expired',
    next_attempt_at = null,
    lease_owner = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    last_error_category = 'delivery_window',
    last_error_code = 'delivery_window_elapsed',
    last_error_safe = null,
    completed_at = coalesce(d.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where d.expires_at is not null
    and d.expires_at <= clock_timestamp()
    and (
      d.state in ('pending','retry_wait')
      or (
        d.state = 'processing'
        and d.lease_expires_at is not null
        and d.lease_expires_at <= clock_timestamp()
      )
    );

  return query
  with candidates as (
    select d.id
    from public.notification_deliveries d
    where private.studio_has_module(d.studio_id, 'notifications')
      and d.attempt_count < d.max_attempts
      and (d.expires_at is null or d.expires_at > clock_timestamp())
      and (
        (d.state = 'pending' and d.available_at <= clock_timestamp())
        or (
          d.state = 'retry_wait'
          and coalesce(d.next_attempt_at, d.available_at) <= clock_timestamp()
        )
        or (
          d.state = 'processing'
          and d.lease_expires_at is not null
          and d.lease_expires_at <= clock_timestamp()
        )
      )
    order by coalesce(d.next_attempt_at, d.available_at), d.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_deliveries d
    set
      state = 'processing',
      lease_owner = trim(p_worker_id),
      lease_acquired_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
    from candidates c
    where d.id = c.id
    returning
      d.id,
      d.studio_id,
      d.job_id,
      d.notification_id,
      d.channel_key,
      d.adapter_key,
      d.attempt_count,
      d.max_attempts
  )
  select
    c.id,
    c.studio_id,
    c.job_id,
    c.notification_id,
    c.channel_key,
    c.adapter_key,
    c.attempt_count,
    c.max_attempts
  from claimed c;
end;
$function$;

CREATE OR REPLACE FUNCTION public.system_claim_notification_jobs(p_worker_id text, p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 60)
 RETURNS TABLE(job_id uuid, studio_id uuid, notification_id uuid, channel_key text, is_required boolean, attempt_count integer, max_attempts integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_notification_id uuid;
begin
  if trim(coalesce(p_worker_id,''))='' then raise exception 'notification_worker_id_required'; end if;
  if p_limit is null or p_limit<1 or p_limit>200 then raise exception 'notification_claim_limit_invalid'; end if;
  if p_lease_seconds is null or p_lease_seconds<10 or p_lease_seconds>900 then raise exception 'notification_lease_invalid'; end if;

  update public.notification_jobs j set
    state='expired',
    state_reason_code='delivery_window_elapsed',
    state_reason_detail=null,
    state_actor_type='system',state_actor_id=null,
    lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,
    completed_at=coalesce(j.completed_at,clock_timestamp())
  where j.state in ('ready','scheduled','retry_wait')
    and j.expires_at is not null
    and j.expires_at<=clock_timestamp();

  for v_notification_id in
    select distinct j.notification_id
    from public.notification_jobs j
    where private.studio_has_module(j.studio_id, 'notifications')
      and j.attempt_count<j.max_attempts
      and (j.expires_at is null or j.expires_at>clock_timestamp())
      and (
        (j.state='ready' and j.available_at<=clock_timestamp())
        or (j.state='scheduled' and j.scheduled_at<=clock_timestamp() and j.available_at<=clock_timestamp())
        or (j.state='retry_wait' and coalesce(j.next_attempt_at,j.available_at)<=clock_timestamp())
        or (j.state='processing' and j.lease_expires_at is not null and j.lease_expires_at<=clock_timestamp())
      )
    order by j.notification_id
    limit least(p_limit*2,400)
  loop
    perform public.system_revalidate_notification_contact(v_notification_id);
  end loop;

  return query
  with candidates as (
    select j.id
    from public.notification_jobs j
    where private.studio_has_module(j.studio_id, 'notifications')
      and j.attempt_count<j.max_attempts
      and (j.expires_at is null or j.expires_at>clock_timestamp())
      and (
        (j.state='ready' and j.available_at<=clock_timestamp())
        or (j.state='scheduled' and j.scheduled_at<=clock_timestamp() and j.available_at<=clock_timestamp())
        or (j.state='retry_wait' and coalesce(j.next_attempt_at,j.available_at)<=clock_timestamp())
        or (j.state='processing' and j.lease_expires_at is not null and j.lease_expires_at<=clock_timestamp())
      )
    order by coalesce(j.next_attempt_at,j.scheduled_at,j.available_at),j.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_jobs j set
      state='processing',
      state_reason_code='handoff_worker_claimed',
      state_reason_detail=null,
      state_actor_type='system',state_actor_id=null,
      lease_owner=trim(p_worker_id),
      lease_acquired_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from candidates c
    where j.id=c.id
    returning j.id,j.studio_id,j.notification_id,j.channel_key,j.is_required,j.attempt_count,j.max_attempts
  )
  select c.id,c.studio_id,c.notification_id,c.channel_key,c.is_required,c.attempt_count,c.max_attempts
  from claimed c;
end;
$function$;
