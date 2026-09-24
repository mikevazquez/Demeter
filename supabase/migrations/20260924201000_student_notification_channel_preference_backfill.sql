alter table public.person_notification_channel_preferences
  alter column push_enabled set default false,
  alter column email_enabled set default false;

insert into public.person_notification_channel_preferences (
  studio_id,person_id,push_enabled,whatsapp_enabled,email_enabled,updated_by_user_id,updated_at
)
select
  s.studio_id,
  s.person_id,
  exists (
    select 1
    from public.push_subscriptions ps
    where ps.studio_id=s.studio_id
      and ps.user_id=s.user_id
      and ps.revoked_at is null
  ),
  true,
  false,
  null,
  clock_timestamp()
from public.students s
where s.person_id is not null
  and s.active
  and s.lifecycle_status='active'
on conflict (studio_id,person_id) do nothing;

create or replace function public.student_get_notification_channel_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_student public.students%rowtype;
  v_pref public.person_notification_channel_preferences%rowtype;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_student
  from public.students s
  where s.user_id=v_uid and s.active and s.lifecycle_status='active'
  order by s.created_at asc
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
    'whatsapp_enabled',coalesce(v_pref.whatsapp_enabled,true),
    'email_enabled',coalesce(v_pref.email_enabled,false)
  );
end;
$function$;

create or replace function private.person_notification_channel_enabled(
  p_studio_id uuid,
  p_person_id uuid,
  p_channel_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case lower(trim(coalesce(p_channel_key,'')))
    when 'push' then coalesce(
      (select p.push_enabled from public.person_notification_channel_preferences p
       where p.studio_id=p_studio_id and p.person_id=p_person_id),
      false
    )
    when 'whatsapp' then coalesce(
      (select p.whatsapp_enabled from public.person_notification_channel_preferences p
       where p.studio_id=p_studio_id and p.person_id=p_person_id),
      true
    )
    when 'email' then coalesce(
      (select p.email_enabled from public.person_notification_channel_preferences p
       where p.studio_id=p_studio_id and p.person_id=p_person_id),
      false
    )
    else true
  end;
$function$;
