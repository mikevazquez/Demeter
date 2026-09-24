-- NOTIFICACIONES-02 · Centro de control de comunicaciones.
-- Public admin contract over the internal notification engine.
-- Keeps P0/P1/P2 internal while exposing business-facing process/channel settings.

create table public.notification_admin_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  email_enabled boolean not null default false,
  non_urgent_send_window text,
  marketing_weekly_limit integer not null default 2,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint notification_admin_settings_window_chk check (
    non_urgent_send_window is null
    or non_urgent_send_window ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  constraint notification_admin_settings_marketing_limit_chk check (
    marketing_weekly_limit between 1 and 14
  )
);

comment on table public.notification_admin_settings is
  'NOTIFICACIONES-02 business-facing communication preferences. Internal communication classes remain hidden.';

alter table public.notification_admin_settings enable row level security;

revoke all on table public.notification_admin_settings from public, anon, authenticated;
grant select, insert, update on table public.notification_admin_settings to authenticated;
grant select, insert, update on table public.notification_admin_settings to service_role;

create policy notification_admin_settings_read
on public.notification_admin_settings
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

create policy notification_admin_settings_insert
on public.notification_admin_settings
for insert
to authenticated
with check (private.has_capability(studio_id, 'automations.manage'));

create policy notification_admin_settings_update
on public.notification_admin_settings
for update
to authenticated
using (private.has_capability(studio_id, 'automations.manage'))
with check (private.has_capability(studio_id, 'automations.manage'));

create or replace function private.seed_notification_admin_settings(
  p_studio_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_admin_settings (
    studio_id,
    push_enabled,
    whatsapp_enabled,
    email_enabled,
    non_urgent_send_window,
    marketing_weekly_limit
  ) values (
    p_studio_id,
    true,
    true,
    false,
    '08:00-21:00',
    2
  )
  on conflict (studio_id) do nothing;
end;
$$;

revoke all on function private.seed_notification_admin_settings(uuid)
from public, anon, authenticated, service_role;

create or replace function private.seed_notification_admin_settings_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_notification_admin_settings(new.id);
  return new;
end;
$$;

revoke all on function private.seed_notification_admin_settings_trigger()
from public, anon, authenticated, service_role;

drop trigger if exists studios_seed_notification_admin_settings on public.studios;
create trigger studios_seed_notification_admin_settings
after insert on public.studios
for each row execute function private.seed_notification_admin_settings_trigger();

do $$
declare
  v_studio_id uuid;
begin
  for v_studio_id in select id from public.studios loop
    perform private.seed_notification_admin_settings(v_studio_id);
  end loop;
end $$;

create or replace function private.clone_notification_rule_version(
  p_rule_id uuid,
  p_channel_key text default null,
  p_channel_enabled boolean default null,
  p_message_mode text default 'none',
  p_title_template text default null,
  p_body_template text default null,
  p_minutes_before integer default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.notification_rules%rowtype;
  v_current public.notification_rule_versions%rowtype;
  v_next integer;
  v_channel public.notification_rule_channels%rowtype;
  v_previous_channel public.notification_rule_channels%rowtype;
  v_policy jsonb;
  v_target_exists boolean := false;
  v_channel_mode boolean := p_channel_key is not null and p_channel_enabled is not null;
  v_message_mode text := lower(trim(coalesce(p_message_mode, 'none')));
  v_timing_config jsonb;
begin
  select *
    into v_rule
  from public.notification_rules
  where id = p_rule_id
  for update;

  if not found then
    raise exception 'notification_rule_not_found';
  end if;

  select *
    into v_current
  from public.notification_rule_versions
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number;

  if not found then
    raise exception 'notification_rule_version_not_found';
  end if;

  if p_channel_key is not null
     and p_channel_key not in ('push','whatsapp','email','inbox') then
    raise exception 'notification_channel_invalid';
  end if;

  if v_message_mode not in ('none','set','reset') then
    raise exception 'notification_message_mode_invalid';
  end if;

  if v_message_mode <> 'none' then
    if p_channel_key not in ('push','email','inbox') then
      raise exception 'notification_channel_message_provider_managed';
    end if;

    if v_message_mode = 'set'
       and (
         length(trim(coalesce(p_title_template, ''))) = 0
         or length(trim(coalesce(p_body_template, ''))) = 0
       ) then
      raise exception 'notification_message_title_body_required';
    end if;
  end if;

  if p_minutes_before is not null then
    if v_current.timing_strategy_key <> 'before_session_start' then
      raise exception 'notification_timing_not_configurable';
    end if;
    if p_minutes_before < 0 or p_minutes_before > 10080 then
      raise exception 'notification_timing_out_of_range';
    end if;
  end if;

  if v_channel_mode then
    select exists (
      select 1
      from public.notification_rule_channels rc
      where rc.rule_id = v_rule.id
        and rc.version_number = v_rule.current_version_number
        and rc.channel_key = p_channel_key
    ) into v_target_exists;

    if v_target_exists = p_channel_enabled
       and v_message_mode = 'none'
       and p_minutes_before is null then
      return v_rule.current_version_number;
    end if;
  end if;

  if v_message_mode <> 'none' then
    select exists (
      select 1
      from public.notification_rule_channels rc
      where rc.rule_id = v_rule.id
        and rc.version_number = v_rule.current_version_number
        and rc.channel_key = p_channel_key
    ) into v_target_exists;

    if not v_target_exists then
      raise exception 'notification_channel_not_enabled';
    end if;
  end if;

  v_next := v_rule.current_version_number + 1;
  v_timing_config := v_current.timing_config;

  if p_minutes_before is not null then
    v_timing_config := jsonb_set(
      coalesce(v_timing_config, '{}'::jsonb),
      '{minutes_before}',
      to_jsonb(p_minutes_before),
      true
    );
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
    created_by_user_id,
    created_at,
    activated_at
  ) values (
    v_current.studio_id,
    v_current.rule_id,
    v_next,
    v_current.notification_type,
    v_current.communication_class,
    v_current.priority,
    v_current.recipient_strategy_key,
    v_current.conditions,
    v_current.timing_strategy_key,
    v_timing_config,
    v_current.revalidation_strategy_key,
    v_current.template_key,
    v_current.expires_after_seconds,
    auth.uid(),
    clock_timestamp(),
    clock_timestamp()
  );

  for v_channel in
    select *
    from public.notification_rule_channels
    where rule_id = v_rule.id
      and version_number = v_rule.current_version_number
    order by ordinal, channel_key
  loop
    if v_channel_mode
       and v_channel.channel_key = p_channel_key
       and p_channel_enabled = false then
      continue;
    end if;

    v_policy := v_channel.channel_policy;

    if v_message_mode <> 'none'
       and v_channel.channel_key = p_channel_key then
      if v_message_mode = 'reset' then
        v_policy := v_policy - 'title_template' - 'body_template';
      else
        v_policy := v_policy || jsonb_build_object(
          'title_template', trim(p_title_template),
          'body_template', trim(p_body_template)
        );
      end if;
    end if;

    insert into public.notification_rule_channels (
      studio_id,
      rule_id,
      version_number,
      channel_key,
      is_required,
      ordinal,
      channel_policy
    ) values (
      v_channel.studio_id,
      v_channel.rule_id,
      v_next,
      v_channel.channel_key,
      v_channel.is_required,
      v_channel.ordinal,
      v_policy
    );
  end loop;

  if v_channel_mode
     and p_channel_enabled = true
     and not v_target_exists then
    select *
      into v_previous_channel
    from public.notification_rule_channels
    where rule_id = v_rule.id
      and channel_key = p_channel_key
    order by version_number desc
    limit 1;

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
      v_rule.id,
      v_next,
      p_channel_key,
      coalesce(v_previous_channel.is_required, false),
      coalesce(
        v_previous_channel.ordinal,
        case p_channel_key
          when 'push' then 0
          when 'inbox' then 1
          when 'whatsapp' then 2
          else 3
        end
      ),
      coalesce(
        v_previous_channel.channel_policy,
        '{"delivery_max_attempts":3}'::jsonb
      )
    );
  end if;

  update public.notification_rules
  set current_version_number = v_next,
      updated_by_user_id = auth.uid(),
      updated_at = clock_timestamp()
  where id = v_rule.id;

  return v_next;
end;
$$;

revoke all on function private.clone_notification_rule_version(
  uuid,text,boolean,text,text,text,integer
) from public, anon, authenticated, service_role;

create or replace function public.admin_notification_rules_snapshot(
  p_studio_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_capability(p_studio_id, 'automations.read') then
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
$$;

revoke all on function public.admin_notification_rules_snapshot(uuid)
from public, anon, authenticated;
grant execute on function public.admin_notification_rules_snapshot(uuid)
to authenticated;

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

create or replace function public.admin_set_notification_rules_channel(
  p_studio_id uuid,
  p_rule_keys text[],
  p_channel_key text,
  p_enabled boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_count integer := 0;
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
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
$$;

revoke all on function public.admin_set_notification_rules_channel(uuid,text[],text,boolean)
from public, anon, authenticated;
grant execute on function public.admin_set_notification_rules_channel(uuid,text[],text,boolean)
to authenticated;

create or replace function public.admin_update_notification_rules_message(
  p_studio_id uuid,
  p_rule_keys text[],
  p_channel_key text,
  p_title_template text,
  p_body_template text,
  p_reset boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_count integer := 0;
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
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
$$;

revoke all on function public.admin_update_notification_rules_message(uuid,text[],text,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.admin_update_notification_rules_message(uuid,text[],text,text,text,boolean)
to authenticated;

create or replace function public.admin_update_notification_rules_lead_time(
  p_studio_id uuid,
  p_rule_keys text[],
  p_minutes_before integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_count integer := 0;
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
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
$$;

revoke all on function public.admin_update_notification_rules_lead_time(uuid,text[],integer)
from public, anon, authenticated;
grant execute on function public.admin_update_notification_rules_lead_time(uuid,text[],integer)
to authenticated;

create or replace function public.admin_save_notification_settings(
  p_studio_id uuid,
  p_push_enabled boolean,
  p_whatsapp_enabled boolean,
  p_email_enabled boolean,
  p_non_urgent_send_window text,
  p_marketing_weekly_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window text := nullif(trim(coalesce(p_non_urgent_send_window, '')), '');
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
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
$$;

revoke all on function public.admin_save_notification_settings(uuid,boolean,boolean,boolean,text,integer)
from public, anon, authenticated;
grant execute on function public.admin_save_notification_settings(uuid,boolean,boolean,boolean,text,integer)
to authenticated;

-- Apply studio-level channel availability to future materializations.
-- Inbox remains an internal Studio Flow channel and is not user-disableable.
create or replace function public.service_get_notification_rules_for_event(
  p_studio_id uuid,
  p_event_type text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
    and r.event_type = trim(p_event_type)
    and r.enabled
    and r.archived_at is null
    and v.activated_at is not null;
$$;

revoke all on function public.service_get_notification_rules_for_event(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_get_notification_rules_for_event(uuid,text)
to service_role;
