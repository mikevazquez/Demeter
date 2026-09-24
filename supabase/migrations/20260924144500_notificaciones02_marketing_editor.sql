-- NOTIFICACIONES-02 · Marketing editor persistence
-- Business-facing draft/editor state for marketing communications.
-- Saving a draft never activates a runtime trigger by itself.

create table if not exists public.notification_marketing_configs (
  studio_id uuid not null references public.studios(id) on delete cascade,
  marketing_key text not null check (length(trim(marketing_key)) > 0),
  status text not null default 'draft'
    check (status in ('draft','active','paused')),
  audience_key text not null default 'all_eligible'
    check (audience_key in (
      'all_eligible',
      'active_students',
      'inactive_students',
      'package_expiring',
      'package_expired',
      'trial_no_purchase'
    )),
  send_window text,
  push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  email_enabled boolean not null default false,
  title_template text,
  body_template text,
  cta_label text,
  cta_href text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id, marketing_key),
  constraint notification_marketing_configs_send_window_chk check (
    send_window is null
    or send_window ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
  )
);

comment on table public.notification_marketing_configs is
  'NOTIFICACIONES-02 business-facing marketing editor state. Draft persistence is inert until a connected runtime trigger is explicitly activated.';

alter table public.notification_marketing_configs enable row level security;

revoke all on table public.notification_marketing_configs
from public, anon, authenticated;

grant select, insert, update on table public.notification_marketing_configs
to authenticated;

grant select, insert, update on table public.notification_marketing_configs
to service_role;

drop policy if exists notification_marketing_configs_read
on public.notification_marketing_configs;

create policy notification_marketing_configs_read
on public.notification_marketing_configs
for select
to authenticated
using (private.has_capability(studio_id, 'automations.read'));

drop policy if exists notification_marketing_configs_insert
on public.notification_marketing_configs;

create policy notification_marketing_configs_insert
on public.notification_marketing_configs
for insert
to authenticated
with check (private.has_capability(studio_id, 'automations.manage'));

drop policy if exists notification_marketing_configs_update
on public.notification_marketing_configs;

create policy notification_marketing_configs_update
on public.notification_marketing_configs
for update
to authenticated
using (private.has_capability(studio_id, 'automations.manage'))
with check (private.has_capability(studio_id, 'automations.manage'));

create index if not exists notification_marketing_configs_updated_by_idx
  on public.notification_marketing_configs(updated_by_user_id)
  where updated_by_user_id is not null;

create or replace function public.admin_notification_marketing_snapshot(
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
$$;

revoke all on function public.admin_notification_marketing_snapshot(uuid)
from public, anon, authenticated;

grant execute on function public.admin_notification_marketing_snapshot(uuid)
to authenticated;

create or replace function public.admin_save_notification_marketing_config(
  p_studio_id uuid,
  p_marketing_key text,
  p_status text,
  p_audience_key text,
  p_send_window text,
  p_push_enabled boolean,
  p_whatsapp_enabled boolean,
  p_email_enabled boolean,
  p_title_template text,
  p_body_template text,
  p_cta_label text,
  p_cta_href text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := trim(coalesce(p_marketing_key, ''));
  v_status text := trim(coalesce(p_status, 'draft'));
  v_audience text := trim(coalesce(p_audience_key, 'all_eligible'));
  v_window text := nullif(trim(coalesce(p_send_window, '')), '');
begin
  if not private.has_capability(p_studio_id, 'automations.manage') then
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
$$;

revoke all on function public.admin_save_notification_marketing_config(
  uuid,text,text,text,text,boolean,boolean,boolean,text,text,text,text
) from public, anon, authenticated;

grant execute on function public.admin_save_notification_marketing_config(
  uuid,text,text,text,text,boolean,boolean,boolean,text,text,text,text
) to authenticated;
