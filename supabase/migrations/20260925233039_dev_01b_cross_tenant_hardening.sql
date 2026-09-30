create or replace function private.is_studio_member(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      private.requested_studio_id() is null
      or target_studio_id = private.requested_studio_id()
    )
    and exists (
      select 1
      from public.studio_memberships sm
      where sm.studio_id = target_studio_id
        and sm.user_id = (select auth.uid())
        and sm.active
    );
$$;

create or replace function private.has_studio_role(
  target_studio_id uuid,
  allowed_roles public.studio_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      private.requested_studio_id() is null
      or target_studio_id = private.requested_studio_id()
    )
    and exists (
      select 1
      from public.studio_memberships sm
      where sm.studio_id = target_studio_id
        and sm.user_id = (select auth.uid())
        and sm.active
        and sm.role = any(allowed_roles)
    );
$$;

create or replace function private.has_capability(
  p_studio_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      private.requested_studio_id() is null
      or p_studio_id = private.requested_studio_id()
    )
    and exists (
      select 1
      from public.studio_memberships m
      join public.role_capabilities rc on rc.role = m.role
      where m.studio_id = p_studio_id
        and m.user_id = (select auth.uid())
        and m.active = true
        and rc.capability_key = p_capability
    );
$$;

create or replace function private.current_instructor_id(target_studio_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
  from public.studio_memberships sm
  join public.instructors i
    on i.studio_id = sm.studio_id
   and i.person_id = sm.person_id
   and i.status = 'active'
  join public.role_capabilities rc
    on rc.role = sm.role
   and rc.capability_key = 'instructor.portal'
  where sm.studio_id = target_studio_id
    and (
      private.requested_studio_id() is null
      or target_studio_id = private.requested_studio_id()
    )
    and sm.user_id = (select auth.uid())
    and sm.active = true
    and sm.person_id is not null
  limit 1;
$$;

drop policy if exists reservations_select on public.reservations;
drop policy if exists reservations_student_linked_self_read on public.reservations;

create policy reservations_select
on public.reservations
for select
to authenticated
using (
  (
    student_id is not null
    and private.is_current_student(student_id, studio_id)
  )
  or private.has_studio_role(
    studio_id,
    array['owner'::public.studio_role,'admin'::public.studio_role]
  )
  or private.is_current_instructor_session(studio_id, session_id)
);

drop policy if exists app_notifications_select on public.app_notifications;

create policy app_notifications_select
on public.app_notifications
for select
to authenticated
using (
  (
    recipient_user_id = (select auth.uid())
    and private.is_studio_member(studio_id)
  )
  or (
    recipient_kind = 'student'
    and student_id is not null
    and private.is_current_student(student_id, studio_id)
  )
  or (
    recipient_kind = 'instructor'
    and instructor_id is not null
    and private.is_current_instructor_assignment(studio_id, instructor_id)
  )
  or private.has_capability(studio_id, 'schedule.write')
);

revoke execute on function public.service_notification_channel_allowed(uuid,text,uuid,text)
from public, anon, authenticated;
grant execute on function public.service_notification_channel_allowed(uuid,text,uuid,text)
to service_role;

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='student_list_reward_challenges'
    and pg_get_function_identity_arguments(p.oid)='p_studio_id uuid';
  if v_def not ilike '%private.is_current_student(id, studio_id)%' then
    v_old := E'  where studio_id = p_studio_id\n    and user_id = (select auth.uid())\n  order by created_at';
    v_new := E'  where studio_id = p_studio_id\n    and user_id = (select auth.uid())\n    and private.is_current_student(id, studio_id)\n  order by created_at';
    if position(v_old in v_def)=0 then raise exception 'student_list_reward_challenges_shape_changed'; end if;
    execute replace(v_def,v_old,v_new);
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='student_enroll_reward_challenge'
    and pg_get_function_identity_arguments(p.oid)='p_rule_id uuid';
  if v_def not ilike '%private.is_current_student(id, studio_id)%' then
    v_old := E'  where studio_id = v_rule.studio_id\n    and user_id = (select auth.uid())\n  order by created_at';
    v_new := E'  where studio_id = v_rule.studio_id\n    and user_id = (select auth.uid())\n    and private.is_current_student(id, studio_id)\n  order by created_at';
    if position(v_old in v_def)=0 then raise exception 'student_enroll_reward_challenge_shape_changed'; end if;
    execute replace(v_def,v_old,v_new);
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='student_archive_reward_challenge'
    and pg_get_function_identity_arguments(p.oid)='p_rule_id uuid';
  if v_def not ilike '%private.is_current_student(id, studio_id)%' then
    v_old := E'  where studio_id = v_rule.studio_id\n    and user_id = (select auth.uid())\n  order by created_at';
    v_new := E'  where studio_id = v_rule.studio_id\n    and user_id = (select auth.uid())\n    and private.is_current_student(id, studio_id)\n  order by created_at';
    if position(v_old in v_def)=0 then raise exception 'student_archive_reward_challenge_shape_changed'; end if;
    execute replace(v_def,v_old,v_new);
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='student_reward_challenge_leaderboard'
    and pg_get_function_identity_arguments(p.oid)='p_rule_id uuid';
  if v_def not ilike '%private.is_current_student(id, studio_id)%' then
    v_old := E'  where studio_id = v_rule.studio_id\n    and user_id = (select auth.uid())\n  order by created_at';
    v_new := E'  where studio_id = v_rule.studio_id\n    and user_id = (select auth.uid())\n    and private.is_current_student(id, studio_id)\n  order by created_at';
    if position(v_old in v_def)=0 then raise exception 'student_reward_challenge_leaderboard_shape_changed'; end if;
    execute replace(v_def,v_old,v_new);
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='student_claim_reward_credits'
    and pg_get_function_identity_arguments(p.oid)='p_reward_instance_id uuid';
  if v_def not ilike '%private.is_current_student(id, studio_id)%' then
    v_old := E'  where id = v_reward.student_id\n    and studio_id = v_reward.studio_id\n    and user_id = (select auth.uid())\n  order by created_at';
    v_new := E'  where id = v_reward.student_id\n    and studio_id = v_reward.studio_id\n    and user_id = (select auth.uid())\n    and private.is_current_student(id, studio_id)\n  order by created_at';
    if position(v_old in v_def)=0 then raise exception 'student_claim_reward_credits_shape_changed'; end if;
    execute replace(v_def,v_old,v_new);
  end if;
end
$$;

create or replace function public.get_my_push_notification_status(p_studio_id uuid)
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

  if not private.is_studio_member(p_studio_id) then
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

  if not private.is_studio_member(p_studio_id) then
    raise exception 'push_membership_required';
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
$$;

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

  if not private.is_studio_member(p_studio_id) then
    raise exception 'push_membership_required';
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

create or replace function private.is_current_user_studio_owner_path(p_studio_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
begin
  begin
    v_studio_id := p_studio_text::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return private.has_studio_role(
    v_studio_id,
    array['owner'::public.studio_role]
  );
end;
$$;
