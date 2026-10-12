create or replace function public.mark_my_app_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_notification public.app_notifications%rowtype;
  v_requested_studio uuid := private.requested_studio_id();
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_notification
  from public.app_notifications
  where id=p_notification_id
  for update;

  if not found then
    raise exception 'notification_not_found';
  end if;

  if v_requested_studio is not null and v_notification.studio_id <> v_requested_studio then
    raise exception 'forbidden';
  end if;

  if not (
    v_notification.recipient_user_id=(select auth.uid())
    or (
      v_notification.recipient_kind='student'
      and v_notification.student_id is not null
      and private.is_current_student(v_notification.student_id,v_notification.studio_id)
    )
    or (
      v_notification.recipient_kind='instructor'
      and v_notification.instructor_id is not null
      and private.is_current_instructor_assignment(v_notification.studio_id,v_notification.instructor_id)
    )
  ) then
    raise exception 'forbidden';
  end if;

  update public.app_notifications
  set read_at=coalesce(read_at,clock_timestamp())
  where id=v_notification.id;
end;
$$;
