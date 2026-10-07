-- Connect package recovery to the central notification event engine.
-- Seeded disabled; no channel beyond the required Studio Flow inbox is selected.

create or replace function private.seed_package_recovery_notification_rules(p_studio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_rule_id uuid;
begin
  if p_studio_id is null then
    raise exception 'package_recovery_studio_required';
  end if;

  for v_item in
    select * from (values
      ('marketing.package_recovery_1', 'package_recovery_1', 7),
      ('marketing.package_recovery_2', 'package_recovery_2', 14)
    ) as item(rule_key, template_key, days_after)
  loop
    insert into public.notification_rules (
      studio_id, rule_key, event_type, enabled, current_version_number
    ) values (
      p_studio_id, v_item.rule_key, 'package.expired_due', false, 1
    ) on conflict (studio_id, rule_key) do nothing;

    select r.id into v_rule_id
    from public.notification_rules r
    where r.studio_id = p_studio_id and r.rule_key = v_item.rule_key;

    if not exists (
      select 1 from public.notification_rule_versions v
      where v.rule_id = v_rule_id and v.version_number = 1
    ) then
      insert into public.notification_rule_versions (
        studio_id, rule_id, version_number, notification_type,
        communication_class, priority, recipient_strategy_key, conditions,
        timing_strategy_key, timing_config, revalidation_strategy_key,
        template_key, expires_after_seconds, activated_at
      ) values (
        p_studio_id, v_rule_id, 1, 'package_recovery', 'P2', 'low',
        'payload_student', '{}'::jsonb, 'after_event',
        jsonb_build_object('days_after', v_item.days_after),
        'package_not_renewed', v_item.template_key, 259200, clock_timestamp()
      );

      insert into public.notification_rule_channels (
        studio_id, rule_id, version_number, channel_key, is_required, ordinal,
        channel_policy
      ) values (
        p_studio_id, v_rule_id, 1, 'inbox', true, 1, '{}'::jsonb
      ) on conflict (rule_id, version_number, channel_key) do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function private.seed_package_recovery_notification_rules(uuid)
from public, anon, authenticated, service_role;

create or replace function private.seed_package_recovery_notification_rules_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_package_recovery_notification_rules(new.id);
  return new;
end;
$$;

revoke all on function private.seed_package_recovery_notification_rules_trigger()
from public, anon, authenticated, service_role;

drop trigger if exists zzz_studios_seed_package_recovery_notifications on public.studios;
create trigger zzz_studios_seed_package_recovery_notifications
after insert on public.studios
for each row execute function private.seed_package_recovery_notification_rules_trigger();

do $$
declare
  v_studio record;
begin
  for v_studio in select id from public.studios loop
    perform private.seed_package_recovery_notification_rules(v_studio.id);
  end loop;
end;
$$;

create or replace function public.admin_update_package_recovery_delay(
  p_studio_id uuid,
  p_first_days integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_current public.notification_rule_versions%rowtype;
  v_channel public.notification_rule_channels%rowtype;
  v_next integer;
  v_days integer;
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
    raise exception 'forbidden';
  end if;
  if p_first_days is null or p_first_days < 1 or p_first_days > 90 then
    raise exception 'package_recovery_delay_out_of_range';
  end if;
  if (p_first_days * 2) > 180 then
    raise exception 'package_recovery_followup_delay_out_of_range';
  end if;

  if (
    select count(*) from public.notification_rules r
    where r.studio_id = p_studio_id
      and r.rule_key in ('marketing.package_recovery_1','marketing.package_recovery_2')
      and r.archived_at is null
  ) <> 2 then
    raise exception 'package_recovery_rules_not_seeded';
  end if;

  for v_rule in
    select r.*,
      case r.rule_key
        when 'marketing.package_recovery_1' then p_first_days
        else p_first_days * 2
      end as days_after
    from public.notification_rules r
    where r.studio_id = p_studio_id
      and r.rule_key in ('marketing.package_recovery_1','marketing.package_recovery_2')
      and r.archived_at is null
    order by r.rule_key
    for update
  loop
    v_days := v_rule.days_after;
    select * into v_current
    from public.notification_rule_versions v
    where v.rule_id = v_rule.id
      and v.version_number = v_rule.current_version_number;
    if not found then raise exception 'notification_rule_version_not_found'; end if;

    if coalesce((v_current.timing_config->>'days_after')::integer, -1) = v_days then
      continue;
    end if;

    v_next := v_rule.current_version_number + 1;
    insert into public.notification_rule_versions (
      studio_id, rule_id, version_number, notification_type,
      communication_class, priority, recipient_strategy_key, conditions,
      timing_strategy_key, timing_config, revalidation_strategy_key,
      template_key, expires_after_seconds, created_by_user_id, activated_at
    ) values (
      v_current.studio_id, v_current.rule_id, v_next, v_current.notification_type,
      v_current.communication_class, v_current.priority, v_current.recipient_strategy_key,
      v_current.conditions, v_current.timing_strategy_key,
      jsonb_set(coalesce(v_current.timing_config, '{}'::jsonb), '{days_after}', to_jsonb(v_days), true),
      v_current.revalidation_strategy_key, v_current.template_key,
      v_current.expires_after_seconds, auth.uid(), clock_timestamp()
    );

    for v_channel in
      select * from public.notification_rule_channels rc
      where rc.rule_id = v_rule.id
        and rc.version_number = v_rule.current_version_number
      order by rc.ordinal, rc.channel_key
    loop
      insert into public.notification_rule_channels (
        studio_id, rule_id, version_number, channel_key, is_required, ordinal, channel_policy
      ) values (
        v_channel.studio_id, v_channel.rule_id, v_next, v_channel.channel_key,
        v_channel.is_required, v_channel.ordinal, v_channel.channel_policy
      );
    end loop;

    update public.notification_rules r
    set current_version_number = v_next,
        updated_by_user_id = auth.uid(),
        updated_at = clock_timestamp()
    where r.id = v_rule.id and r.studio_id = p_studio_id;
  end loop;

  return p_first_days;
end;
$$;

revoke all on function public.admin_update_package_recovery_delay(uuid,integer)
from public, anon, service_role;
grant execute on function public.admin_update_package_recovery_delay(uuid,integer)
to authenticated;

create or replace function public.system_cancel_package_recovery_notifications(
  p_studio_id uuid,
  p_student_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  with targets as (
    select n.id as notification_id, j.id as job_id
    from public.notifications n
    join public.domain_events e
      on e.studio_id = n.studio_id and e.event_id = n.source_event_id
    join public.notification_jobs j
      on j.studio_id = n.studio_id and j.notification_id = n.id
    where n.studio_id = p_studio_id
      and n.recipient_type = 'student'
      and n.recipient_entity_id = p_student_id
      and e.event_type = 'package.expired_due'
      and n.template_key in ('package_recovery_1','package_recovery_2')
      and n.state = 'active'
      and j.state in ('ready','scheduled','processing','retry_wait')
    for update of n, j
  ), cancelled_jobs as (
    update public.notification_jobs j set
      state = 'cancelled', state_reason_code = 'package_renewed_before_recovery',
      state_reason_detail = 'A newer active package was purchased before recovery delivery.',
      state_actor_type = 'system', state_actor_id = null,
      lease_owner = null, lease_acquired_at = null, lease_expires_at = null,
      next_attempt_at = null, completed_at = coalesce(j.completed_at, clock_timestamp())
    from targets t where j.id = t.job_id
    returning j.notification_id
  ), cancelled_deliveries as (
    update public.notification_deliveries d set
      state = 'skipped', last_error_category = 'eligibility',
      last_error_code = 'package_renewed_before_recovery',
      last_error_safe = 'A newer active package was purchased before recovery delivery.',
      lease_owner = null, lease_acquired_at = null, lease_expires_at = null,
      next_attempt_at = null, completed_at = coalesce(d.completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
    from targets t
    where d.job_id = t.job_id and d.state in ('pending','retry_wait')
    returning d.id
  )
  select count(*)::integer into v_count from cancelled_jobs;

  update public.notifications n set
    state = 'cancelled', state_reason_code = 'package_renewed_before_recovery',
    state_reason_detail = 'A newer active package was purchased before recovery delivery.',
    cancelled_at = coalesce(n.cancelled_at, clock_timestamp())
  where n.studio_id = p_studio_id and n.recipient_type = 'student'
    and n.recipient_entity_id = p_student_id and n.state = 'active'
    and n.template_key in ('package_recovery_1','package_recovery_2')
    and exists (
      select 1 from public.notification_jobs j
      where j.studio_id = n.studio_id and j.notification_id = n.id
        and j.state = 'cancelled'
        and j.state_reason_code = 'package_renewed_before_recovery'
    )
    and exists (
      select 1 from public.domain_events e
      where e.studio_id = n.studio_id and e.event_id = n.source_event_id
        and e.event_type = 'package.expired_due'
    );

  return v_count;
end;
$$;

revoke all on function public.system_cancel_package_recovery_notifications(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.system_cancel_package_recovery_notifications(uuid,uuid)
to service_role;
