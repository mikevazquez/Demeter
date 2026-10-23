-- Preserve the existing invoker/RLS boundary. Serialize the RPC without requiring table UPDATE grants just to take a row lock.
create or replace function public.set_student_pole_figure_achievement(
  p_student_id uuid,
  p_figure_element_id uuid,
  p_completed boolean,
  p_class_session_id uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_studio_id uuid;
  v_existing_id uuid;
begin
  select s.studio_id into v_studio_id
  from public.students s
  where s.id=p_student_id and s.lifecycle_status<>'archived';
  if v_studio_id is null then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_studio_id,'evaluations.write') then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pole_figure_profiles p where p.studio_id=v_studio_id and p.element_id=p_figure_element_id) then raise exception 'pole_figure_not_found'; end if;
  if p_class_session_id is not null and not exists(select 1 from public.class_sessions cs where cs.studio_id=v_studio_id and cs.id=p_class_session_id) then raise exception 'class_session_not_found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_studio_id::text || ':' || p_student_id::text || ':' || p_figure_element_id::text,0));
  select a.id into v_existing_id from public.student_pole_figure_achievements a
  where a.studio_id=v_studio_id and a.student_id=p_student_id and a.figure_element_id=p_figure_element_id;

  if p_completed and v_existing_id is null then
    insert into public.student_pole_figure_achievements(studio_id,student_id,figure_element_id,source,marked_by,class_session_id,achieved_at,validated_at)
    values(v_studio_id,p_student_id,p_figure_element_id,'instructor',auth.uid(),p_class_session_id,now(),now());
    insert into public.student_pole_figure_achievement_events(studio_id,student_id,figure_element_id,action,actor_user_id,class_session_id)
    values(v_studio_id,p_student_id,p_figure_element_id,'marked',auth.uid(),p_class_session_id);
    return true;
  end if;
  if not p_completed and v_existing_id is not null then
    delete from public.student_pole_figure_achievements where id=v_existing_id;
    insert into public.student_pole_figure_achievement_events(studio_id,student_id,figure_element_id,action,actor_user_id,class_session_id)
    values(v_studio_id,p_student_id,p_figure_element_id,'unmarked',auth.uid(),p_class_session_id);
    return false;
  end if;
  return p_completed;
end;
$function$;
revoke all on function public.set_student_pole_figure_achievement(uuid,uuid,boolean,uuid) from public, anon;
grant execute on function public.set_student_pole_figure_achievement(uuid,uuid,boolean,uuid) to authenticated;
