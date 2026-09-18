-- Flow 02 corrective migration: public lifecycle RPCs call a private helper.
-- They remain capability-gated internally and use an empty search_path.
alter function public.admin_set_student_lifecycle(uuid, public.student_lifecycle_status)
  security definer;

alter function public.admin_delete_student(uuid)
  security definer;
