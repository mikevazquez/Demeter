drop policy if exists online_checkout_attempts_student_self_read
  on public.online_checkout_attempts;
drop policy if exists online_checkout_attempts_staff_read
  on public.online_checkout_attempts;

create policy online_checkout_attempts_scoped_read
on public.online_checkout_attempts for select to authenticated
using (
  private.is_current_student(student_id, studio_id)
  or (select private.has_capability(studio_id, 'sales.read'))
);

revoke all on public.online_checkout_attempts from public, anon, authenticated;
grant select on public.online_checkout_attempts to authenticated;

