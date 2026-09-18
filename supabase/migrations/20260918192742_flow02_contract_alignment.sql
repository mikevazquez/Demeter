
create or replace function public.admin_set_student_lifecycle(
  p_student_id uuid,
  p_status public.student_lifecycle_status
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found or not private.has_capability(v_student.studio_id, 'students.archive') then
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
    studio_id, student_id, from_status, to_status, changed_by
  ) values (
    v_student.studio_id,
    p_student_id,
    v_student.lifecycle_status,
    p_status,
    (select auth.uid())
  );
end;
$$;

create or replace function public.admin_delete_student(
  p_student_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_person_id uuid;
  v_user_id uuid;
  v_cancelled integer := 0;
begin
  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found or not private.has_capability(v_student.studio_id, 'students.archive') then
    raise exception 'students_archive_denied';
  end if;

  if v_student.lifecycle_status = 'archived' then
    return jsonb_build_object(
      'ok', true,
      'already_deleted', true,
      'cancelled_reservations', 0
    );
  end if;

  v_person_id := v_student.person_id;
  v_user_id := v_student.user_id;

  v_cancelled := private.cancel_future_student_reservations(
    p_student_id,
    'Reserva cancelada por el estudio al eliminar a la alumna'
  );

  delete from public.student_lifecycle_events
  where student_id = p_student_id;

  if v_user_id is not null then
    delete from public.studio_memberships
    where studio_id = v_student.studio_id
      and user_id = v_user_id
      and role = 'student';
  end if;

  update public.reservations
  set student_user_id = null,
      updated_at = now()
  where student_id = p_student_id
    and student_user_id is not null;

  update public.student_packages
  set student_user_id = null
  where student_id = p_student_id
    and student_user_id is not null;

  if v_person_id is not null then
    delete from public.profile_field_values pfv
    using public.profile_field_definitions pfd
    where pfv.definition_id = pfd.id
      and pfv.person_id = v_person_id
      and pfd.studio_id = v_student.studio_id
      and pfd.entity_type = 'student';
  end if;

  update public.students
  set user_id = null,
      person_id = null,
      full_name = 'Alumna eliminada',
      phone = null,
      email = null,
      active = false,
      lifecycle_status = 'archived',
      profile_status = 'incomplete',
      archived_at = now(),
      archived_by = (select auth.uid()),
      updated_at = now()
  where id = p_student_id;

  if v_person_id is not null
     and not exists (
       select 1 from public.instructors i where i.person_id = v_person_id
     )
     and not exists (
       select 1 from public.students s
       where s.person_id = v_person_id and s.id <> p_student_id
     ) then
    delete from public.persons where id = v_person_id;
  end if;

  if v_user_id is not null
     and not exists (
       select 1 from public.studio_memberships sm
       where sm.user_id = v_user_id and sm.active = true
     ) then
    update public.user_accounts
    set status = 'disabled',
        updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_deleted', false,
    'cancelled_reservations', v_cancelled,
    'former_user_id', v_user_id
  );
end;
$$;
