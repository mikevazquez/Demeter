-- WHATSAPP-META-01 · Multi-provider WhatsApp routing.
-- Keeps Asistian available while adding Meta WhatsApp Cloud API as an independent provider.

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

create table if not exists public.meta_whatsapp_accounts (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  phone_number_id text not null,
  waba_id text,
  graph_version text not null default 'v26.0',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_whatsapp_accounts_phone_number_id_chk
    check (phone_number_id ~ '^[0-9]{5,30}$'),
  constraint meta_whatsapp_accounts_waba_id_chk
    check (waba_id is null or waba_id ~ '^[0-9]{5,30}$'),
  constraint meta_whatsapp_accounts_graph_version_chk
    check (graph_version ~ '^v[0-9]+\\.[0-9]+$')
);

create table if not exists public.meta_whatsapp_template_mappings (
  studio_id uuid not null references public.studios(id) on delete cascade,
  internal_template_key text not null,
  meta_template_name text not null,
  language_code text not null default 'es_MX',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id, internal_template_key),
  constraint meta_whatsapp_template_mappings_internal_chk
    check (length(trim(internal_template_key)) > 0),
  constraint meta_whatsapp_template_mappings_meta_chk
    check (meta_template_name ~ '^[a-z0-9_]+$'),
  constraint meta_whatsapp_template_mappings_language_chk
    check (language_code ~ '^[a-z]{2}(_[A-Z]{2})?$')
);

alter table public.notification_studio_channel_providers enable row level security;
alter table public.meta_whatsapp_accounts enable row level security;
alter table public.meta_whatsapp_template_mappings enable row level security;

revoke all on table public.notification_studio_channel_providers from public, anon, authenticated;
revoke all on table public.meta_whatsapp_accounts from public, anon, authenticated;
revoke all on table public.meta_whatsapp_template_mappings from public, anon, authenticated;

grant select, insert, update, delete on table public.notification_studio_channel_providers to service_role;
grant select, insert, update, delete on table public.meta_whatsapp_accounts to service_role;
grant select, insert, update, delete on table public.meta_whatsapp_template_mappings to service_role;

create or replace function public.admin_set_whatsapp_provider(
  target_studio_id uuid,
  target_provider_key text,
  target_make_default boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(trim(coalesce(target_provider_key, '')));
  v_adapter text;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_provider not in ('asistian', 'meta_whatsapp') then
    raise exception 'whatsapp_provider_not_allowed';
  end if;

  v_adapter := v_provider;

  insert into public.notification_studio_channel_providers (
    studio_id, channel_key, provider_key, adapter_key, enabled, is_default
  ) values (
    target_studio_id, 'whatsapp', v_provider, v_adapter, true, coalesce(target_make_default, true)
  )
  on conflict (studio_id, channel_key, provider_key) do update
  set
    adapter_key = excluded.adapter_key,
    enabled = true,
    is_default = excluded.is_default,
    updated_at = clock_timestamp();

  if coalesce(target_make_default, true) then
    update public.notification_studio_channel_providers
    set
      is_default = false,
      updated_at = clock_timestamp()
    where studio_id = target_studio_id
      and channel_key = 'whatsapp'
      and provider_key <> v_provider
      and is_default;
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_whatsapp_provider(uuid,text,boolean)
from public, anon, service_role;
grant execute on function public.admin_set_whatsapp_provider(uuid,text,boolean)
to authenticated;

create or replace function public.admin_set_meta_whatsapp_credentials(
  target_studio_id uuid,
  target_phone_number_id text,
  target_waba_id text,
  target_access_token text,
  target_graph_version text default 'v26.0'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := trim(coalesce(target_phone_number_id, ''));
  v_waba text := nullif(trim(coalesce(target_waba_id, '')), '');
  v_token text := trim(coalesce(target_access_token, ''));
  v_graph text := trim(coalesce(target_graph_version, 'v26.0'));
  v_secret_name text := 'meta_whatsapp_access_token:' || target_studio_id::text;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_phone !~ '^[0-9]{5,30}$' then
    raise exception 'meta_phone_number_id_invalid';
  end if;

  if v_waba is not null and v_waba !~ '^[0-9]{5,30}$' then
    raise exception 'meta_waba_id_invalid';
  end if;

  if length(v_token) < 20 then
    raise exception 'meta_access_token_invalid';
  end if;

  if v_graph !~ '^v[0-9]+\\.[0-9]+$' then
    raise exception 'meta_graph_version_invalid';
  end if;

  insert into public.meta_whatsapp_accounts (
    studio_id, phone_number_id, waba_id, graph_version, enabled
  ) values (
    target_studio_id, v_phone, v_waba, v_graph, true
  )
  on conflict (studio_id) do update
  set
    phone_number_id = excluded.phone_number_id,
    waba_id = excluded.waba_id,
    graph_version = excluded.graph_version,
    enabled = true,
    updated_at = clock_timestamp();

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_token,
      v_secret_name,
      'Studio Flow Meta WhatsApp Cloud API access token'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_token,
      v_secret_name,
      'Studio Flow Meta WhatsApp Cloud API access token'
    );
  end if;

  insert into public.notification_studio_channel_providers (
    studio_id, channel_key, provider_key, adapter_key, enabled, is_default
  ) values (
    target_studio_id, 'whatsapp', 'meta_whatsapp', 'meta_whatsapp', true, false
  )
  on conflict (studio_id, channel_key, provider_key) do update
  set
    adapter_key = excluded.adapter_key,
    enabled = true,
    updated_at = clock_timestamp();

  return true;
end;
$$;

revoke all on function public.admin_set_meta_whatsapp_credentials(uuid,text,text,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_meta_whatsapp_credentials(uuid,text,text,text,text)
to authenticated;

create or replace function public.admin_set_meta_whatsapp_template(
  target_studio_id uuid,
  target_internal_template_key text,
  target_meta_template_name text,
  target_language_code text default 'es_MX'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal text := trim(coalesce(target_internal_template_key, ''));
  v_meta text := lower(trim(coalesce(target_meta_template_name, '')));
  v_language text := trim(coalesce(target_language_code, 'es_MX'));
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_internal not in (
    'student_welcome',
    'reservation_confirmed',
    'reservation_cancelled',
    'waitlist_promoted',
    'class_reminder',
    'class_cancelled_coach'
  ) then
    raise exception 'meta_internal_template_not_allowed';
  end if;

  if v_meta !~ '^[a-z0-9_]+$' then
    raise exception 'meta_template_name_invalid';
  end if;

  if v_language !~ '^[a-z]{2}(_[A-Z]{2})?$' then
    raise exception 'meta_template_language_invalid';
  end if;

  insert into public.meta_whatsapp_template_mappings (
    studio_id, internal_template_key, meta_template_name, language_code, enabled
  ) values (
    target_studio_id, v_internal, v_meta, v_language, true
  )
  on conflict (studio_id, internal_template_key) do update
  set
    meta_template_name = excluded.meta_template_name,
    language_code = excluded.language_code,
    enabled = true,
    updated_at = clock_timestamp();

  return true;
end;
$$;

revoke all on function public.admin_set_meta_whatsapp_template(uuid,text,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_meta_whatsapp_template(uuid,text,text,text)
to authenticated;

create or replace function public.admin_get_whatsapp_provider_status(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default text;
  v_meta public.meta_whatsapp_accounts%rowtype;
  v_mappings jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select p.provider_key
    into v_default
  from public.notification_studio_channel_providers p
  where p.studio_id = target_studio_id
    and p.channel_key = 'whatsapp'
    and p.enabled
    and p.is_default
  limit 1;

  select *
    into v_meta
  from public.meta_whatsapp_accounts a
  where a.studio_id = target_studio_id
    and a.enabled;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'internal_template_key', m.internal_template_key,
        'meta_template_name', m.meta_template_name,
        'language_code', m.language_code,
        'enabled', m.enabled
      )
      order by m.internal_template_key
    ),
    '[]'::jsonb
  )
    into v_mappings
  from public.meta_whatsapp_template_mappings m
  where m.studio_id = target_studio_id;

  return jsonb_build_object(
    'default_provider', coalesce(v_default, 'asistian'),
    'asistian_available', true,
    'meta_configured', v_meta.studio_id is not null,
    'meta_phone_number_id', v_meta.phone_number_id,
    'meta_waba_id', v_meta.waba_id,
    'meta_graph_version', coalesce(v_meta.graph_version, 'v26.0'),
    'meta_templates', v_mappings
  );
end;
$$;

revoke all on function public.admin_get_whatsapp_provider_status(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_whatsapp_provider_status(uuid)
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
  if v_requested <> '' then
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

create or replace function public.service_get_meta_whatsapp_delivery_config(
  target_studio_id uuid,
  target_internal_template_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.meta_whatsapp_accounts%rowtype;
  v_mapping public.meta_whatsapp_template_mappings%rowtype;
  v_token text;
begin
  select *
    into v_account
  from public.meta_whatsapp_accounts a
  where a.studio_id = target_studio_id
    and a.enabled;

  if v_account.studio_id is null then
    return null;
  end if;

  select *
    into v_mapping
  from public.meta_whatsapp_template_mappings m
  where m.studio_id = target_studio_id
    and m.internal_template_key = trim(coalesce(target_internal_template_key, ''))
    and m.enabled;

  if v_mapping.studio_id is null then
    return null;
  end if;

  select s.decrypted_secret
    into v_token
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_access_token:' || target_studio_id::text
  limit 1;

  if v_token is null or length(trim(v_token)) < 20 then
    return null;
  end if;

  return jsonb_build_object(
    'phone_number_id', v_account.phone_number_id,
    'waba_id', v_account.waba_id,
    'graph_version', v_account.graph_version,
    'access_token', v_token,
    'meta_template_name', v_mapping.meta_template_name,
    'language_code', v_mapping.language_code
  );
end;
$$;

revoke all on function public.service_get_meta_whatsapp_delivery_config(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_get_meta_whatsapp_delivery_config(uuid,text)
to service_role;
