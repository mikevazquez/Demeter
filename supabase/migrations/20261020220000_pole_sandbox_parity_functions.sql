-- Paridad con Sandbox: estas funciones se cambiaron en Sandbox fuera del historial.
--  * pole_save_plan: el combo de clase exige que las figuras intermedias sean del mismo tipo
--    que la figura nueva (además de la de entrada y la nueva).
--  * pole_snapshot: para el equipo agrega quién marcó la figura y la fecha de la clase.
-- Texto tomado de pg_get_functiondef en Sandbox (22-oct-2026). Los permisos se conservan.
-- set_student_pole_figure_achievement en Sandbox equivale a la versión de 20261020214233.

CREATE OR REPLACE FUNCTION private.pole_save_plan(p_session uuid, p_level text, p_group text, p_sequence uuid[], p_new uuid, p_students uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sess public.class_sessions; discipline uuid; sid uuid; fid uuid; l text; expected uuid[];
begin
 select * into sess from public.class_sessions where id=p_session;
 if auth.uid() is null or not private.has_capability(sess.studio_id,'evaluations.write') then raise exception 'forbidden'; end if;
 select discipline_id into discipline from public.class_templates where id=sess.template_id;
 if p_level not in ('principiante','intermedio','avanzado') or p_group not in (p_level,'sin_evaluacion') or (p_group='sin_evaluacion' and p_level<>'principiante') then raise exception 'pole_plan_invalid'; end if;
 select array_agg(distinct r.student_id order by r.student_id) into expected from public.reservations r where r.session_id=p_session and r.status in ('reserved','attended') and r.student_id is not null and
 case when private.pole_level(r.student_id,discipline) is null then 'sin_evaluacion' when private.pole_level(r.student_id,discipline) in ('intermediate','upper_intermediate') then 'intermedio' when private.pole_level(r.student_id,discipline) in ('advanced','elite') then 'avanzado' else 'principiante' end=p_group;
 if expected is null or expected is distinct from (select array_agg(distinct x order by x) from unnest(p_students) x) or cardinality(p_sequence) not between 2 and 4 or p_sequence[2]<>p_new or (select count(distinct x) from unnest(p_sequence) x)<>cardinality(p_sequence) then raise exception 'pole_plan_invalid'; end if;
 if not exists(select 1 from public.pole_figure_prerequisites where figure_element_id=p_new and required_element_id=p_sequence[1]) then raise exception 'pole_plan_invalid'; end if;
 foreach sid in array expected loop
 perform 1 from public.students where id=sid for update;
 if private.pole_state(sid,p_new)<>'disponible' then raise exception 'pole_plan_stale'; end if;
 foreach fid in array p_sequence loop
 if not exists(select 1 from public.pole_figure_profiles f join public.technical_elements e on e.id=f.element_id where f.element_id=fid and f.studio_id=sess.studio_id and f.discipline_id=discipline and f.in_core_program and not f.requires_authorization and e.active and private.pole_rank(f.catalog_level)<=private.pole_rank(p_level) and (fid<>p_new or f.catalog_level=p_level) and (fid=p_new or fid=p_sequence[1] or f.figure_type=(select figure_type from public.pole_figure_profiles where element_id=p_new))) then raise exception 'pole_plan_invalid'; end if;
 if fid<>p_new and private.pole_state(sid,fid)<>'lograda' then raise exception 'pole_plan_stale'; end if;
 end loop;
 end loop;
 insert into public.class_session_pole_plans(studio_id,class_session_id,catalog_level,group_key,sequence,new_figure_element_id,student_ids,created_by) values(sess.studio_id,p_session,p_level,p_group,p_sequence,p_new,expected,auth.uid())
 on conflict(studio_id,class_session_id,group_key) do update set sequence=excluded.sequence,new_figure_element_id=p_new,student_ids=expected,created_by=auth.uid(),created_at=now();
end $function$;

CREATE OR REPLACE FUNCTION private.pole_snapshot(p_student uuid, p_discipline uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.students; staff boolean; l text; figures jsonb;
begin
 select * into s from public.students where id=p_student;
 staff:=private.has_capability(s.studio_id,'evaluations.read');
 if auth.uid() is null or not (staff or private.is_current_student(p_student,s.studio_id)) then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.disciplines where id=p_discipline and studio_id=s.studio_id) then raise exception 'forbidden'; end if;
 l:=private.pole_level(p_student,p_discipline);
 select coalesce(jsonb_agg(jsonb_build_object('id',f.element_id,'slug',f.slug,'name',e.name,'originalName',f.original_name,'description',e.description,'level',f.catalog_level,'type',f.figure_type,'family',f.family,'core',f.in_core_program,'active',e.active,'requiresAuthorization',f.requires_authorization,'sortOrder',f.sort_order,
 'prerequisites',(select coalesce(jsonb_agg(p.required_element_id),'[]') from public.pole_figure_prerequisites p where p.figure_element_id=f.element_id),
 'missing',(select coalesce(jsonb_agg(p.required_element_id),'[]') from public.pole_figure_prerequisites p where p.figure_element_id=f.element_id and not exists(select 1 from public.student_pole_figure_achievements x where x.student_id=p_student and x.figure_element_id=p.required_element_id)),
 'state',private.pole_state(p_student,f.element_id),'source',a.source,'markedBy',a.marked_by,'classSessionId',a.class_session_id,'achievedAt',a.achieved_at,'validatedAt',a.validated_at,'photoPath',a.photo_path,'authorizationActive',exists(select 1 from public.student_pole_authorizations au where au.student_id=p_student and au.figure_element_id=f.element_id and au.revoked_at is null))
 || case when staff then jsonb_build_object('bookPage',f.book_page,'markedByName',(select full_name from public.profiles where id=a.marked_by),'classSessionAt',(select starts_at from public.class_sessions where id=a.class_session_id)) else '{}'::jsonb end order by f.sort_order),'[]') into figures
 from public.pole_figure_profiles f join public.technical_elements e on e.id=f.element_id left join public.student_pole_figure_achievements a on a.figure_element_id=f.element_id and a.student_id=p_student and a.studio_id=f.studio_id
 where f.studio_id=s.studio_id and f.discipline_id=p_discipline and (staff or (e.active and (f.in_core_program or f.requires_authorization)));
 return jsonb_build_object('studentId',p_student,'studentName',s.full_name,'disciplineId',p_discipline,'technicalLevel',l,'counterLevel',case when l in ('intermediate','upper_intermediate') then 'intermedio' when l in ('advanced','elite') then 'avanzado' else 'principiante' end,'figures',figures);
end $function$;

