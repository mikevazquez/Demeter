-- Reproduce the effective function ACL verified in the F14 production baseline.
-- In production anon cannot execute the student lifecycle mutation directly.

revoke execute on function public.admin_set_student_lifecycle(uuid, public.student_lifecycle_status) from anon;
