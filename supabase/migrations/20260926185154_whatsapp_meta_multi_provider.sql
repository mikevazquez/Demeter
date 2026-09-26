-- WHATSAPP-META-01B · Keep Asistian and Meta as coexisting WhatsApp providers.
-- Restores Asistian as the safe global fallback and adds per-studio provider selection.

create table if not exists public.notification_studio_channel_providers (
  studio_id uuid not null references public.studios(id) on delete cascade,
  channel_key text not null references public.notification_channels(channel_key) on delete cascade,
  provider_key text not null,
  adapter_key text not null,
  enabled boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id, channel_key, provider_key),
  constraint notification_studio_channel_providers_provider_chk
    check (length(trim(provider_key)) > 0),
  constraint notification_studio_channel_providers_adapter_chk
    check (length(trim(adapter_key)) > 0)
);

create unique index if not exists notification_studio_channel_providers_default_idx
  on public.notification_studio_channel_providers(studio_id, channel_key)
  where is_default and enabled;

alter table public.notification_studio_channel_providers enable row level security;

revoke all on table public.notification_studio_channel_providers
from public, anon, authenticated;

grant select, insert, update, delete
on table public.notification_studio_channel_providers
to service_role;

-- Keep the original provider as the platform-wide fallback.
insert into public.notification_channel_adapters (
  channel_key, adapter_key, provider_key, enabled
) values
  ('whatsapp', 'asistian', 'asistian', true)
on conflict (channel_key) do update
set
  adapter_key = excluded.adapter_key,
  provider_key = excluded.provider_key,
  enabled = excluded.enabled,
  updated_at = clock_timestamp();

create or replace function public.admin_set_whatsapp_provider(
  target_studio_id uuid,
  target_provider_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(trim(coalesce(target_provider_key, '')));
  v_adapter text;
  v_meta_secret_exists boolean := false;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_provider not in ('asistian', 'meta_whatsapp') then
    raise exception 'whatsapp_provider_not_allowed';
  end if;

  if v_provider = 'meta_whatsapp' then
    select exists (
      select 1
      from vault.secrets s
      where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
    ) into v_meta_secret_exists;

    if not v_meta_secret_exists then
      raise exception 'meta_whatsapp_not_configured';
    end if;
  end if;

  v_adapter := v_provider;

  update public.notification_studio_channel_providers
  set
    is_default = false,
    updated_at = clock_timestamp()
  where studio_id = target_studio_id
    and channel_key = 'whatsapp'
    and is_default;

  insert into public.notification_studio_channel_providers (
    studio_id,
    channel_key,
    provider_key,
    adapter_key,
    enabled,
    is_default
  ) values (
    target_studio_id,
    'whatsapp',
    v_provider,
    v_adapter,
    true,
    true
  )
  on conflict (studio_id, channel_key, provider_key) do update
  set
    adapter_key = excluded.adapter_key,
    enabled = true,
    is_default = true,
    updated_at = clock_timestamp();

  return true;
end;
$$;

revoke all on function public.admin_set_whatsapp_provider(uuid,text)
from public, anon, service_role;

grant execute on function public.admin_set_whatsapp_provider(uuid,text)
to authenticated;

create or replace function public.admin_get_whatsapp_provider(
  target_studio_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select p.provider_key
    into v_provider
  from public.notification_studio_channel_providers p
  where p.studio_id = target_studio_id
    and p.channel_key = 'whatsapp'
    and p.enabled
    and p.is_default
  limit 1;

  return coalesce(v_provider, 'asistian');
end;
$$;

revoke all on function public.admin_get_whatsapp_provider(uuid)
from public, anon, service_role;

grant execute on function public.admin_get_whatsapp_provider(uuid)
to authenticated;

create or replace function public.service_resolve_whatsapp_provider(
  target_studio_id uuid,
  requested_provider text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested text := lower(trim(coalesce(requested_provider, '')));
  v_provider text;
begin
  if v_requested in ('asistian', 'meta_whatsapp') then
    select p.provider_key
      into v_provider
    from public.notification_studio_channel_providers p
    where p.studio_id = target_studio_id
      and p.channel_key = 'whatsapp'
      and p.provider_key = v_requested
      and p.enabled
    limit 1;

    if v_provider is not null then
      return v_provider;
    end if;
  end if;

  select p.provider_key
    into v_provider
  from public.notification_studio_channel_providers p
  where p.studio_id = target_studio_id
    and p.channel_key = 'whatsapp'
    and p.enabled
    and p.is_default
  limit 1;

  return coalesce(v_provider, 'asistian');
end;
$$;

revoke all on function public.service_resolve_whatsapp_provider(uuid,text)
from public, anon, authenticated;

grant execute on function public.service_resolve_whatsapp_provider(uuid,text)
to service_role;
