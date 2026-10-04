-- Demi security hardening.
-- Several SECURITY DEFINER functions were replaced by later migrations and inherited
-- PostgreSQL's default EXECUTE privilege for PUBLIC again. Lock the assistant surface
-- back to authenticated studio admins and trusted service-role runtimes only.

revoke all on function public.admin_join_waitlist(uuid,uuid)
from public, anon;
grant execute on function public.admin_join_waitlist(uuid,uuid)
to authenticated, service_role;

revoke all on function public.admin_reschedule_student_reservation(uuid,uuid,text)
from public, anon;
grant execute on function public.admin_reschedule_student_reservation(uuid,uuid,text)
to authenticated, service_role;

revoke all on function public.admin_waitlist_preview(uuid,uuid)
from public, anon;
grant execute on function public.admin_waitlist_preview(uuid,uuid)
to authenticated, service_role;

revoke all on function public.assistant_book_payment_pending(uuid,uuid,uuid,uuid)
from public, anon;
grant execute on function public.assistant_book_payment_pending(uuid,uuid,uuid,uuid)
to authenticated, service_role;

revoke all on function public.assistant_confirm_trial_booking(uuid,uuid,uuid,uuid,uuid)
from public, anon;
grant execute on function public.assistant_confirm_trial_booking(uuid,uuid,uuid,uuid,uuid)
to authenticated, service_role;

revoke all on function public.assistant_create_handoff(uuid,uuid,uuid,text,text)
from public, anon;
grant execute on function public.assistant_create_handoff(uuid,uuid,uuid,text,text)
to authenticated, service_role;

revoke all on function public.assistant_create_online_enrollment_intent(uuid,uuid,uuid,uuid)
from public, anon;
grant execute on function public.assistant_create_online_enrollment_intent(uuid,uuid,uuid,uuid)
to authenticated, service_role;

revoke all on function public.assistant_create_post_trial_reservation(uuid,uuid,uuid,uuid,text)
from public, anon;
grant execute on function public.assistant_create_post_trial_reservation(uuid,uuid,uuid,uuid,text)
to authenticated, service_role;

revoke all on function public.assistant_ensure_trial_student(uuid,uuid)
from public, anon;
grant execute on function public.assistant_ensure_trial_student(uuid,uuid)
to authenticated, service_role;

revoke all on function public.assistant_post_trial_requirement(uuid,uuid)
from public, anon;
grant execute on function public.assistant_post_trial_requirement(uuid,uuid)
to authenticated, service_role;

revoke all on function public.assistant_record_trial_payment_preference(uuid,uuid,text)
from public, anon;
grant execute on function public.assistant_record_trial_payment_preference(uuid,uuid,text)
to authenticated, service_role;

revoke all on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid)
from public, anon;
grant execute on function public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid)
to authenticated, service_role;
