drop policy if exists persons_identity_scoped_read on public.persons;
create policy persons_identity_scoped_read
on public.persons for select to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or exists (
    select 1
    from public.students s
    where s.person_id = persons.id
      and s.studio_id = persons.studio_id
      and private.has_capability(persons.studio_id, 'students.read')
  )
  or exists (
    select 1
    from public.studio_memberships m
    where m.studio_id = persons.studio_id
      and m.person_id = persons.id
      and m.user_id = (select auth.uid())
      and m.active = true
  )
  or exists (
    select 1
    from public.students s
    where s.person_id = persons.id
      and s.studio_id = persons.studio_id
      and private.is_current_student(s.id, s.studio_id)
  )
);

drop policy if exists person_contacts_identity_scoped_read on public.person_contacts;
create policy person_contacts_identity_scoped_read
on public.person_contacts for select to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or exists (
    select 1
    from public.students s
    where s.person_id = person_contacts.person_id
      and s.studio_id = person_contacts.studio_id
      and private.has_capability(person_contacts.studio_id, 'students.read')
  )
  or exists (
    select 1
    from public.studio_memberships m
    where m.studio_id = person_contacts.studio_id
      and m.person_id = person_contacts.person_id
      and m.user_id = (select auth.uid())
      and m.active = true
  )
  or exists (
    select 1
    from public.students s
    where s.person_id = person_contacts.person_id
      and s.studio_id = person_contacts.studio_id
      and private.is_current_student(s.id, s.studio_id)
  )
);
