drop function if exists public.student_portal_snapshot_for_studio(uuid);

drop index if exists public.students_user_unique;
create unique index if not exists students_studio_user_unique
  on public.students (studio_id,user_id)
  where user_id is not null;

create or replace function private.requested_studio_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_raw text;
begin
  v_raw := nullif(
    coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-studio-id',
    ''
  );

  if v_raw is null then
    return null;
  end if;

  begin
    return v_raw::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke all on function private.requested_studio_id() from public;
grant execute on function private.requested_studio_id() to authenticated;

create or replace function private.is_current_student(
  target_student_id uuid,
  target_studio_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.students s
    join public.studio_memberships sm
      on sm.studio_id=s.studio_id
     and sm.user_id=(select auth.uid())
     and sm.role='student'
     and sm.active=true
    where s.id=target_student_id
      and s.studio_id=target_studio_id
      and s.user_id=(select auth.uid())
      and s.active=true
      and s.lifecycle_status='active'
      and (
        private.requested_studio_id() is null
        or s.studio_id = private.requested_studio_id()
      )
      and private.has_capability(s.studio_id,'student.portal')
  );
$$;

create or replace function public.student_get_notification_channel_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_pref public.person_notification_channel_preferences%rowtype;
  v_requested_studio uuid := private.requested_studio_id();
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if v_requested_studio is null then raise exception 'studio_context_required'; end if;

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
$$;

create or replace function public.student_set_notification_channel_preference(
  p_channel_key text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.student_get_notification_channel_preferences() from public;
revoke all on function public.student_set_notification_channel_preference(text,boolean) from public;
grant execute on function public.student_get_notification_channel_preferences() to authenticated;
grant execute on function public.student_set_notification_channel_preference(text,boolean) to authenticated;
