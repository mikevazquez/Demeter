-- F11 · SF-116 Instructor hardening.
-- `instructors.read` remains a capability, but an Instructor account may only read its own
-- instructor record. Other staff roles that legitimately carry instructors.read keep their
-- operational studio-level visibility.

drop policy if exists instructors_read on public.instructors;

create policy instructors_read on public.instructors
for select to authenticated
using (
  (
    private.has_capability(studio_id, 'instructors.read')
    and not private.has_studio_role(studio_id, array['instructor'::public.studio_role])
  )
  or exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = instructors.studio_id
      and sm.user_id = (select auth.uid())
      and sm.role = 'instructor'::public.studio_role
      and sm.active = true
      and sm.person_id = instructors.person_id
  )
);
