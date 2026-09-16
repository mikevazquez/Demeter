alter function public.service_link_student_access(uuid, uuid) security definer;
alter function public.service_link_student_access(uuid, uuid) set search_path = '';

revoke all on function public.service_link_student_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_link_student_access(uuid, uuid) to service_role;
