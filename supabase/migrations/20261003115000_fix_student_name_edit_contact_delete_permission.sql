-- admin_update_student is SECURITY INVOKER and may remove the email contact
-- when an administrator clears/leaves email blank. Table privileges must allow
-- the DELETE before the existing RLS policy can enforce students.write scope.
--
-- RLS remains the authorization boundary:
-- person_contacts_student_staff_write requires students.write for the row's studio.

grant delete on table public.person_contacts to authenticated;
