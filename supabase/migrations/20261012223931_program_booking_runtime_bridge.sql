-- Preserve this database's exact regular-class eligibility rules before routing program
-- sessions through the program-aware path. Sandbox and production can have different
-- session-credit columns or authorization rules, so capture the installed function.
do $$
declare
  v_definition text;
begin
  if to_regprocedure('private.booking_eligibility_regular_program_baseline(uuid,uuid)') is null then
    select pg_get_functiondef('public.booking_eligibility(uuid,uuid)'::regprocedure)
      into v_definition;
    if v_definition is null then
      raise exception 'booking_eligibility_baseline_missing';
    end if;
    v_definition := replace(
      v_definition,
      'FUNCTION public.booking_eligibility(',
      'FUNCTION private.booking_eligibility_regular_program_baseline('
    );
    if position('FUNCTION private.booking_eligibility_regular_program_baseline(' in v_definition) = 0 then
      raise exception 'booking_eligibility_baseline_capture_failed';
    end if;
    execute v_definition;
    execute 'revoke all on function private.booking_eligibility_regular_program_baseline(uuid,uuid) from public, anon, authenticated';
  end if;
end;
$$;

create or replace function public.booking_eligibility(target_session_id uuid,target_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_studio uuid; v_program uuid; v_user uuid;
begin
 select cs.studio_id,ct.program_id into v_studio,v_program from public.class_sessions cs join public.class_templates ct on ct.id=cs.template_id where cs.id=target_session_id;
 if v_program is null then return private.booking_eligibility_regular_program_baseline(target_session_id,target_student_id); end if;
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 select user_id into v_user from public.students where id=target_student_id and studio_id=v_studio;
 if not private.has_capability(v_studio,'schedule.write') and not private.has_capability(v_studio,'reservations.manage')
    and not (v_user=auth.uid() and private.has_capability(v_studio,'student.booking.self'))
 then raise exception 'forbidden'; end if;
 return private.booking_eligibility_core(target_session_id,target_student_id,false);
end;
$$;
revoke all on function public.booking_eligibility(uuid,uuid) from public,anon;
grant execute on function public.booking_eligibility(uuid,uuid) to authenticated,service_role;
