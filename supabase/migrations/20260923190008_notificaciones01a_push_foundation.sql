-- NOTIFICACIONES-01A · PWA + Web Push foundation.
-- Push subscriptions are device/browser capabilities. Direct table access stays service-only;
-- authenticated users manage only their own subscription through hardened RPCs.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  expiration_time bigint,
  user_agent text,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_subscriptions_endpoint_https_chk
    check (endpoint ~ '^https://[^[:space:]]+$' and length(endpoint) <= 2048),
  constraint push_subscriptions_p256dh_chk
    check (p256dh ~ '^[A-Za-z0-9_-]+$' and length(p256dh) between 40 and 256),
  constraint push_subscriptions_auth_chk
    check (auth_secret ~ '^[A-Za-z0-9_-]+$' and length(auth_secret) between 10 and 128),
  constraint push_subscriptions_user_agent_chk
    check (user_agent is null or length(user_agent) <= 1000),
  constraint push_subscriptions_device_label_chk
    check (device_label is null or length(device_label) <= 160),
  unique (studio_id, endpoint)
);

comment on table public.push_subscriptions is
  'NOTIFICACIONES-01A browser/device Web Push subscriptions. Endpoint and encryption keys are capability data and are never exposed through direct authenticated table access.';

create index push_subscriptions_user_active_idx
  on public.push_subscriptions(studio_id, user_id, last_seen_at desc)
  where revoked_at is null;

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create or replace function public.get_push_vapid_public_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.decrypted_secret
    into v_key
  from vault.decrypted_secrets s
  where s.name = 'web_push_vapid_public_key:v1'
  limit 1;

  if nullif(trim(coalesce(v_key, '')), '') is null then
    raise exception 'push_vapid_not_configured';
  end if;

  return trim(v_key);
end;
$$;

revoke all on function public.get_push_vapid_public_key()
from public, anon, service_role;
grant execute on function public.get_push_vapid_public_key()
to authenticated;

create or replace function public.register_my_push_subscription(
  p_studio_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null,
  p_device_label text default null,
  p_expiration_time bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_id uuid;
  v_endpoint text := trim(coalesce(p_endpoint, ''));
  v_p256dh text := trim(coalesce(p_p256dh, ''));
  v_auth text := trim(coalesce(p_auth, ''));
  v_user_agent text := nullif(trim(coalesce(p_user_agent, '')), '');
  v_device_label text := nullif(trim(coalesce(p_device_label, '')), '');
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
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
    studio_id,
    user_id,
    role_key,
    endpoint,
    p256dh,
    auth_secret,
    expiration_time,
    user_agent,
    device_label,
    created_at,
    updated_at,
    last_seen_at,
    revoked_at
  ) values (
    p_studio_id,
    v_user_id,
    v_role,
    v_endpoint,
    v_p256dh,
    v_auth,
    p_expiration_time,
    v_user_agent,
    v_device_label,
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp(),
    null
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
$$;

revoke all on function public.register_my_push_subscription(
  uuid,text,text,text,text,text,bigint
) from public, anon, service_role;
grant execute on function public.register_my_push_subscription(
  uuid,text,text,text,text,text,bigint
) to authenticated;

create or replace function public.unregister_my_push_subscription(
  p_studio_id uuid,
  p_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_endpoint text := trim(coalesce(p_endpoint, ''));
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  update public.push_subscriptions
  set
    revoked_at = coalesce(revoked_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where studio_id = p_studio_id
    and user_id = v_user_id
    and endpoint = v_endpoint
    and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.unregister_my_push_subscription(uuid,text)
from public, anon, service_role;
grant execute on function public.unregister_my_push_subscription(uuid,text)
to authenticated;

create or replace function public.get_my_push_notification_status(
  p_studio_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
  v_configured boolean;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if not exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = p_studio_id
      and sm.user_id = v_user_id
      and sm.active
  ) then
    raise exception 'push_membership_required';
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
$$;

revoke all on function public.get_my_push_notification_status(uuid)
from public, anon, service_role;
grant execute on function public.get_my_push_notification_status(uuid)
to authenticated;

create or replace function public.service_get_push_vapid_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_public text;
  v_private text;
  v_subject text;
begin
  select s.decrypted_secret into v_public
  from vault.decrypted_secrets s
  where s.name = 'web_push_vapid_public_key:v1'
  limit 1;

  select s.decrypted_secret into v_private
  from vault.decrypted_secrets s
  where s.name = 'web_push_vapid_private_key:v1'
  limit 1;

  select s.decrypted_secret into v_subject
  from vault.decrypted_secrets s
  where s.name = 'web_push_vapid_subject:v1'
  limit 1;

  if nullif(trim(coalesce(v_public, '')), '') is null
     or nullif(trim(coalesce(v_private, '')), '') is null
     or nullif(trim(coalesce(v_subject, '')), '') is null then
    raise exception 'push_vapid_not_configured';
  end if;

  return jsonb_build_object(
    'public_key', trim(v_public),
    'private_key', trim(v_private),
    'subject', trim(v_subject)
  );
end;
$$;

revoke all on function public.service_get_push_vapid_config()
from public, anon, authenticated;
grant execute on function public.service_get_push_vapid_config()
to service_role;

create or replace function public.service_revoke_push_subscription(
  p_subscription_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_subscriptions
  set
    revoked_at = coalesce(revoked_at, clock_timestamp()),
    updated_at = clock_timestamp(),
    device_label = case
      when p_reason is null or trim(p_reason) = '' then device_label
      else left(coalesce(device_label || ' · ', '') || 'revoked:' || trim(p_reason), 160)
    end
  where id = p_subscription_id
    and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.service_revoke_push_subscription(uuid,text)
from public, anon, authenticated;
grant execute on function public.service_revoke_push_subscription(uuid,text)
to service_role;
