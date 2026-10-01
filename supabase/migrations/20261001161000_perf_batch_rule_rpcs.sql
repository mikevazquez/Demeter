-- Studio Flow V2 performance wrappers.
-- These functions batch calls to existing rule-bearing RPCs without changing semantics.

create or replace function public.booking_eligibilities(
  target_session_ids uuid[],
  target_student_id uuid
)
returns table (
  session_id uuid,
  eligibility jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    item.session_id,
    public.booking_eligibility(item.session_id, target_student_id) as eligibility
  from unnest(coalesce(target_session_ids, '{}'::uuid[])) as item(session_id);
$function$;

revoke all on function public.booking_eligibilities(uuid[],uuid) from public,anon;
grant execute on function public.booking_eligibilities(uuid[],uuid) to authenticated;

create or replace function public.student_reservation_checkin_tokens(
  target_reservation_ids uuid[]
)
returns table (
  reservation_id uuid,
  token_data jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    item.reservation_id,
    public.student_reservation_checkin_token(item.reservation_id) as token_data
  from unnest(coalesce(target_reservation_ids, '{}'::uuid[])) as item(reservation_id);
$function$;

revoke all on function public.student_reservation_checkin_tokens(uuid[]) from public,anon;
grant execute on function public.student_reservation_checkin_tokens(uuid[]) to authenticated;
