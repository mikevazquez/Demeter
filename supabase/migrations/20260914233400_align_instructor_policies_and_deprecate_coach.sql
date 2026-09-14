drop policy if exists "student_packages_select" on public.student_packages;
create policy "student_packages_select"
on public.student_packages for select
to authenticated
using (
  student_user_id = (select auth.uid())
  or (select private.has_studio_role(
    student_packages.studio_id,
    array[
      'owner'::public.studio_role,
      'admin'::public.studio_role,
      'instructor'::public.studio_role
    ]
  ))
);

drop policy if exists "reservations_select" on public.reservations;
create policy "reservations_select"
on public.reservations for select
to authenticated
using (
  student_user_id = (select auth.uid())
  or (select private.has_studio_role(
    reservations.studio_id,
    array[
      'owner'::public.studio_role,
      'admin'::public.studio_role,
      'instructor'::public.studio_role
    ]
  ))
);

drop policy if exists "students_staff_select" on public.students;
create policy "students_staff_select"
on public.students for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_studio_role(
    students.studio_id,
    array[
      'owner'::public.studio_role,
      'admin'::public.studio_role,
      'instructor'::public.studio_role
    ]
  ))
);

delete from public.role_capabilities
where role = 'coach'::public.studio_role;
