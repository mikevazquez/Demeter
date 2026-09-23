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
  v_host text;
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
