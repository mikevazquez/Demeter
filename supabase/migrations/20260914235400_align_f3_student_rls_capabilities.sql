-- Align F3 student/person policies with the canonical capability matrix.
-- Instructor must not have broad students.read; roster-scoped access is introduced later with F4/F8/F11.
delete from public.role_capabilities
where role = 'instructor'::public.studio_role
  and capability_key = 'students.read';

-- Students: capability-based staff access, own-record access for linked student accounts,
-- and no normal DELETE path (archive/reactivate is the operational lifecycle).
drop policy if exists students_admin_delete on public.students;
drop policy if exists students_admin_insert on public.students;
drop policy if exists students_admin_update on public.students;
drop policy if exists students_staff_select on public.students;

create policy students_select
on public.students
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.has_capability(studio_id, 'students.read')
);

create policy students_insert
on public.students
for insert
to authenticated
with check (private.has_capability(studio_id, 'students.write'));

create policy students_update
on public.students
for update
to authenticated
using (private.has_capability(studio_id, 'students.write'))
with check (private.has_capability(studio_id, 'students.write'));

-- Persons/contacts are identity-bearing data. During F3 only student-capable staff and
-- the linked student can read them. Instructor-specific scoped identity access is added in F4/F11.
drop policy if exists persons_staff_read on public.persons;
drop policy if exists persons_staff_write on public.persons;
drop policy if exists person_contacts_staff_read on public.person_contacts;
drop policy if exists person_contacts_staff_write on public.person_contacts;

create policy persons_student_staff_read
on public.persons
for select
to authenticated
using (
  private.has_capability(studio_id, 'students.read')
  or exists (
    select 1
    from public.students s
    where s.person_id = persons.id
      and s.user_id = (select auth.uid())
  )
);

create policy persons_student_staff_write
on public.persons
for all
to authenticated
using (private.has_capability(studio_id, 'students.write'))
with check (private.has_capability(studio_id, 'students.write'));

create policy person_contacts_student_staff_read
on public.person_contacts
for select
to authenticated
using (
  private.has_capability(studio_id, 'students.read')
  or exists (
    select 1
    from public.students s
    where s.person_id = person_contacts.person_id
      and s.user_id = (select auth.uid())
  )
);

create policy person_contacts_student_staff_write
on public.person_contacts
for all
to authenticated
using (private.has_capability(studio_id, 'students.write'))
with check (private.has_capability(studio_id, 'students.write'));
