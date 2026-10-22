begin;
create or replace function private.pole_snapshot(p_student uuid,p_discipline uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 || case when staff then jsonb_build_object('bookPage',f.book_page) else '{}'::jsonb end order by f.sort_order),'[]') into figures
 from public.pole_figure_profiles f join public.technical_elements e on e.id=f.element_id left join public.student_pole_figure_achievements a on a.figure_element_id=f.element_id and a.student_id=p_student and a.studio_id=f.studio_id
 where f.studio_id=s.studio_id and f.discipline_id=p_discipline and (staff or (e.active and (f.in_core_program or f.requires_authorization)));
 return jsonb_build_object('studentId',p_student,'studentName',s.full_name,'disciplineId',p_discipline,'technicalLevel',l,'counterLevel',case when l in ('intermediate','upper_intermediate') then 'intermedio' when l in ('advanced','elite') then 'avanzado' else 'principiante' end,'figures',figures);
end $$;

create function private.pole_element_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pole_figure_profiles p where p.element_id=new.id and (p.studio_id<>new.studio_id or p.discipline_id<>new.discipline_id or p.slug is distinct from new.pole_catalog_slug or new.element_kind<>'figure' or (p.catalog_level='por_revisar' and new.active))) then raise exception 'pole_profile_mismatch'; end if;
 return new;
end $$;
revoke all on function private.pole_element_guard() from public,anon,authenticated;
create trigger pole_element_guard before update on public.technical_elements for each row execute function private.pole_element_guard();
commit;
