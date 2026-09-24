-- REWARDS · fix acknowledgement after the 6/6 onboarding unlock.
-- The previous SECURITY INVOKER function could read the row but could not UPDATE reward_onboarding.

create or replace function public.student_acknowledge_medals_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_onboarding_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student_id is null then
    raise exception 'student_context_not_found';
  end if;

  update public.reward_onboarding o
  set access_acknowledged_at = coalesce(o.access_acknowledged_at, now()),
      updated_at = now()
  where o.student_id = v_student_id
    and o.access_unlocked_at is not null
  returning o.id into v_onboarding_id;

  if v_onboarding_id is null then
    raise exception 'medals_access_not_unlocked';
  end if;

  return jsonb_build_object(
    'ok', true,
    'student_id', v_student_id,
    'onboarding_id', v_onboarding_id
  );
end;
$$;

revoke all on function public.student_acknowledge_medals_access()
from public, anon, service_role;

grant execute on function public.student_acknowledge_medals_access()
to authenticated;
