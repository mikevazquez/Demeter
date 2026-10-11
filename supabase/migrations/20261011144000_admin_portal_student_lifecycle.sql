CREATE OR REPLACE FUNCTION public.admin_change_student_lifecycle(p_student_id uuid, p_status public.student_lifecycle_status, p_reason text default null)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found or not private.has_capability(v_student.studio_id, 'students.write') then
    raise exception 'students_archive_denied';
  end if;

  if v_student.lifecycle_status = 'archived' then
    raise exception 'student_deleted';
  end if;

  if p_status not in ('active','inactive') then
    raise exception 'invalid_lifecycle_transition';
  end if;

  if v_student.lifecycle_status = p_status then
    return;
  end if;

  if p_status='inactive' and length(trim(coalesce(p_reason,'')))<3 then raise exception 'lifecycle_reason_required';end if;

  if p_status = 'inactive' then
    if v_student.user_id is not null then
      update public.studio_memberships
      set active = false
      where studio_id = v_student.studio_id
        and user_id = v_student.user_id
        and role = 'student';
    end if;
  else
    if v_student.user_id is not null then
      update public.studio_memberships
      set active = true
      where studio_id = v_student.studio_id
        and user_id = v_student.user_id
        and role = 'student';
    end if;
  end if;

  update public.students
  set lifecycle_status = p_status,
      active = (p_status = 'active'),
      archived_at = null,
      archived_by = null,
      updated_at = now()
  where id = p_student_id;

  insert into public.student_lifecycle_events(
    studio_id, student_id, from_status, to_status, changed_by, reason
  ) values (
    v_student.studio_id,
    p_student_id,
    v_student.lifecycle_status,
    p_status,
    (select auth.uid()),nullif(trim(p_reason),'')
  );
end;
$function$
;

create or replace function public.admin_set_student_lifecycle(p_student_id uuid,p_status public.student_lifecycle_status) returns void language sql set search_path='' as $$ select public.admin_change_student_lifecycle(p_student_id,p_status,null); $$;
revoke all on function public.admin_change_student_lifecycle(uuid,public.student_lifecycle_status,text) from public,anon;
grant execute on function public.admin_change_student_lifecycle(uuid,public.student_lifecycle_status,text) to authenticated;
create or replace function public.service_student_notification_active(p_studio_id uuid,p_student_id uuid,p_template_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.students where studio_id=p_studio_id and id=p_student_id and (p_template_key='password_reset' or (active and lifecycle_status='active')));
$$;
revoke all on function public.service_student_notification_active(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_student_notification_active(uuid,uuid,text) to service_role;

