begin;
create unique index if not exists pole_students_studio_id_uq on public.students(studio_id,id);
create unique index if not exists pole_sessions_studio_id_uq on public.class_sessions(studio_id,id);
-- Pole figures remain evaluation elements. Slugs permit the two distinct Ballerina Variations.
alter table public.technical_elements add column pole_catalog_slug text;
drop index public.technical_elements_name_uq;
create unique index technical_elements_name_uq on public.technical_elements(studio_id,discipline_id,lower(name)) where pole_catalog_slug is null;
create unique index technical_elements_pole_slug_uq on public.technical_elements(studio_id,pole_catalog_slug) where pole_catalog_slug is not null;
create table public.pole_figure_profiles (
 element_id uuid primary key, studio_id uuid not null references public.studios(id), discipline_id uuid not null references public.disciplines(id),
 slug text not null, original_name text not null, catalog_level text not null check(catalog_level in ('principiante','intermedio','avanzado','profesional','por_revisar')),
 discipline_technical_level_id uuid, figure_type text not null, family text not null, in_core_program boolean not null default false,
 requires_authorization boolean not null default false, book_page smallint, sort_order integer not null default 0,
 unique(studio_id,slug), unique(studio_id,element_id),
 foreign key(studio_id,element_id) references public.technical_elements(studio_id,id) on delete cascade,
 foreign key(studio_id,discipline_technical_level_id) references public.discipline_technical_levels(studio_id,id),
 check(requires_authorization = (catalog_level='profesional'))
);
create table public.pole_figure_prerequisites (
 studio_id uuid not null, figure_element_id uuid not null, required_element_id uuid not null,
 primary key(studio_id,figure_element_id,required_element_id), check(figure_element_id<>required_element_id),
 foreign key(studio_id,figure_element_id) references public.pole_figure_profiles(studio_id,element_id) on delete cascade,
 foreign key(studio_id,required_element_id) references public.pole_figure_profiles(studio_id,element_id) on delete restrict
);
create index pole_prerequisite_required_idx on public.pole_figure_prerequisites(studio_id,required_element_id);
create table public.student_pole_figure_achievements (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null, student_id uuid not null, figure_element_id uuid not null,
 source text not null check(source in ('student','instructor')), marked_by uuid not null references auth.users(id),
 class_session_id uuid, achieved_at timestamptz not null default now(), validated_at timestamptz, photo_path text,
 unique(studio_id,student_id,figure_element_id),
 foreign key(studio_id,student_id) references public.students(studio_id,id) on delete cascade,
 foreign key(studio_id,figure_element_id) references public.pole_figure_profiles(studio_id,element_id),
 foreign key(studio_id,class_session_id) references public.class_sessions(studio_id,id)
);
create table public.student_pole_authorizations (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null, student_id uuid not null, figure_element_id uuid not null,
 authorized_by uuid not null references auth.users(id), authorized_at timestamptz not null default now(), revoked_at timestamptz,
 foreign key(studio_id,student_id) references public.students(studio_id,id) on delete cascade,
 foreign key(studio_id,figure_element_id) references public.pole_figure_profiles(studio_id,element_id)
);
create unique index pole_authorization_active_uq on public.student_pole_authorizations(studio_id,student_id,figure_element_id) where revoked_at is null;
create table public.class_session_pole_plans (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null, class_session_id uuid not null,
 catalog_level text not null check(catalog_level in ('principiante','intermedio','avanzado')), group_key text not null,
 sequence uuid[] not null, new_figure_element_id uuid not null, student_ids uuid[] not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(studio_id,class_session_id,group_key),
 foreign key(studio_id,class_session_id) references public.class_sessions(studio_id,id),
 foreign key(studio_id,new_figure_element_id) references public.pole_figure_profiles(studio_id,element_id)
);
create table public.pole_figure_events (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), student_id uuid not null,
 figure_element_id uuid not null, actor_id uuid references auth.users(id), event text not null, occurred_at timestamptz not null default now(), details jsonb not null
);
-- Storage deletions use the Storage API, never DELETE FROM storage.objects. Durable retry outbox.
create table public.pole_photo_cleanup (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null, student_id uuid not null, photo_path text not null,
 created_at timestamptz not null default now(), foreign key(studio_id,student_id) references public.students(studio_id,id)
);
create or replace function private.pole_profile_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.technical_elements e where e.id=new.element_id and e.studio_id=new.studio_id and e.discipline_id=new.discipline_id and e.element_kind='figure' and e.pole_catalog_slug=new.slug and (new.catalog_level<>'por_revisar' or not e.active)) then raise exception 'pole_profile_mismatch'; end if;
 if new.discipline_technical_level_id is not null and not exists(select 1 from public.discipline_technical_levels l where l.id=new.discipline_technical_level_id and l.studio_id=new.studio_id and l.discipline_id=new.discipline_id) then raise exception 'pole_level_mismatch'; end if;
 return new;
end $$;
create trigger pole_profile_guard before insert or update on public.pole_figure_profiles for each row execute function private.pole_profile_guard();
create or replace function private.pole_prerequisite_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Serialize graph edits, including concurrent opposite edges.
 perform 1 from public.studios where id=new.studio_id for update;
 if not exists(select 1 from public.pole_figure_profiles a join public.pole_figure_profiles b on b.discipline_id=a.discipline_id and b.studio_id=a.studio_id where a.element_id=new.figure_element_id and b.element_id=new.required_element_id and a.studio_id=new.studio_id) then raise exception 'pole_prerequisite_mismatch'; end if;
 if exists(with recursive ancestors(id) as (select new.required_element_id union select p.required_element_id from public.pole_figure_prerequisites p join ancestors a on p.figure_element_id=a.id where p.studio_id=new.studio_id) select 1 from ancestors where id=new.figure_element_id) then raise exception 'pole_prerequisite_cycle'; end if;
 return new;
end $$;
create trigger pole_prerequisite_guard before insert or update on public.pole_figure_prerequisites for each row execute function private.pole_prerequisite_guard();
create or replace function private.pole_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 v:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.pole_figure_events(studio_id,student_id,figure_element_id,actor_id,event,details) values((v->>'studio_id')::uuid,(v->>'student_id')::uuid,(v->>'figure_element_id')::uuid,auth.uid(),tg_table_name||':'||tg_op,v);
 if tg_table_name='student_pole_figure_achievements' and tg_op in ('DELETE','UPDATE') then
  if old.photo_path is not null and (tg_op='DELETE' or old.photo_path is distinct from new.photo_path) then
   insert into public.pole_photo_cleanup(studio_id,student_id,photo_path) values(old.studio_id,old.student_id,old.photo_path);
  end if;
 end if;
 return null;
end $$;
create trigger pole_achievement_audit after insert or update or delete on public.student_pole_figure_achievements for each row execute function private.pole_audit();
create trigger pole_authorization_audit after insert or update on public.student_pole_authorizations for each row execute function private.pole_audit();
create or replace function private.pole_level(p_student uuid,p_discipline uuid) returns text language sql stable security definer set search_path='' as $$
 select d.level_key from public.student_discipline_levels s join public.discipline_technical_levels l on l.id=s.discipline_technical_level_id and l.studio_id=s.studio_id join public.technical_level_definitions d on d.id=l.technical_level_id and d.studio_id=l.studio_id where s.student_id=p_student and s.discipline_id=p_discipline;
$$;
create or replace function private.pole_rank(p_level text) returns integer language sql immutable set search_path='' as $$
 select case p_level when 'principiante' then 1 when 'intermedio' then 2 when 'avanzado' then 3 when 'beginner' then 1 when 'intermediate' then 2 when 'upper_intermediate' then 3 when 'advanced' then 3 when 'elite' then 3 else 1 end;
$$;
create or replace function private.pole_state(p_student uuid,p_figure uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare f public.pole_figure_profiles; l text;
begin
 select * into f from public.pole_figure_profiles where element_id=p_figure;
 if f.element_id is null then raise exception 'pole_figure_missing'; end if;
 if exists(select 1 from public.student_pole_figure_achievements where student_id=p_student and figure_element_id=p_figure and studio_id=f.studio_id) then return 'lograda'; end if;
 l:=private.pole_level(p_student,f.discipline_id);
 if f.requires_authorization then
  if l in ('advanced','elite') and exists(select 1 from public.student_pole_authorizations where studio_id=f.studio_id and student_id=p_student and figure_element_id=p_figure and revoked_at is null) then return 'autorizada'; end if;
  return 'requiere_autorizacion';
 end if;
 if private.pole_rank(f.catalog_level)>private.pole_rank(l) then return 'siguiente_nivel'; end if;
 if exists(select 1 from public.pole_figure_prerequisites p where p.figure_element_id=p_figure and not exists(select 1 from public.student_pole_figure_achievements a where a.student_id=p_student and a.studio_id=f.studio_id and a.figure_element_id=p.required_element_id)) then return 'bloqueada'; end if;
 return 'disponible';
end $$;
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
 'state',private.pole_state(p_student,f.element_id),'source',a.source,'markedBy',a.marked_by,'classSessionId',a.class_session_id,'achievedAt',a.achieved_at,'validatedAt',a.validated_at,'photoPath',a.photo_path)
 || case when staff then jsonb_build_object('bookPage',f.book_page) else '{}'::jsonb end order by f.sort_order),'[]') into figures
 from public.pole_figure_profiles f join public.technical_elements e on e.id=f.element_id left join public.student_pole_figure_achievements a on a.figure_element_id=f.element_id and a.student_id=p_student and a.studio_id=f.studio_id
 where f.studio_id=s.studio_id and f.discipline_id=p_discipline and (staff or (e.active and (f.in_core_program or f.requires_authorization)));
 return jsonb_build_object('studentId',p_student,'studentName',s.full_name,'disciplineId',p_discipline,'technicalLevel',l,'counterLevel',case when l in ('intermediate','upper_intermediate') then 'intermedio' when l in ('advanced','elite') then 'avanzado' else 'principiante' end,'figures',figures);
end $$;
create or replace function private.pole_mark(p_figure uuid,p_mark boolean,p_studio uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.students; f public.pole_figure_profiles;
begin
 select * into s from public.students where user_id=auth.uid() and studio_id=p_studio and private.is_current_student(id,studio_id) for update;
 if s.id is null then raise exception 'forbidden'; end if;
 select * into f from public.pole_figure_profiles where element_id=p_figure and studio_id=s.studio_id;
 if f.element_id is null then raise exception 'forbidden'; end if;
 if not p_mark then delete from public.student_pole_figure_achievements where student_id=s.id and figure_element_id=p_figure; return; end if;
 if private.pole_state(s.id,p_figure)='lograda' then return; end if;
 if not exists(select 1 from public.technical_elements where id=p_figure and active) or not (f.in_core_program or f.requires_authorization) or private.pole_state(s.id,p_figure) not in ('disponible','autorizada') then raise exception 'pole_figure_locked'; end if;
 insert into public.student_pole_figure_achievements(studio_id,student_id,figure_element_id,source,marked_by) values(s.studio_id,s.id,p_figure,'student',auth.uid()) on conflict do nothing;
end $$;
create or replace function private.pole_authorize(p_student uuid,p_figure uuid,p_revoke boolean) returns void language plpgsql security definer set search_path='' as $$
declare f public.pole_figure_profiles;
begin
 select * into f from public.pole_figure_profiles where element_id=p_figure;
 if auth.uid() is null or not private.has_capability(f.studio_id,'evaluations.write') then raise exception 'forbidden'; end if;
 perform 1 from public.students where id=p_student and studio_id=f.studio_id for update;
 if not found or not f.requires_authorization then raise exception 'pole_authorization_invalid'; end if;
 if p_revoke then update public.student_pole_authorizations set revoked_at=now() where student_id=p_student and figure_element_id=p_figure and revoked_at is null; return; end if;
 if private.pole_level(p_student,f.discipline_id) not in ('advanced','elite') or private.pole_level(p_student,f.discipline_id) is null or not exists(select 1 from public.technical_elements where id=p_figure and active) then raise exception 'pole_advanced_required'; end if;
 insert into public.student_pole_authorizations(studio_id,student_id,figure_element_id,authorized_by) values(f.studio_id,p_student,p_figure,auth.uid()) on conflict do nothing;
end $$;
create or replace function private.pole_validate(p_session uuid,p_items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare sess public.class_sessions; discipline uuid; item jsonb; sid uuid; fid uuid;
begin
 select * into sess from public.class_sessions where id=p_session;
 if auth.uid() is null or not private.has_capability(sess.studio_id,'evaluations.write') then raise exception 'forbidden'; end if;
 select discipline_id into discipline from public.class_templates where id=sess.template_id;
 for item in select value from jsonb_array_elements(p_items) loop
 sid:=(item->>'student_id')::uuid; fid:=(item->>'figure_id')::uuid;
 perform 1 from public.students where id=sid and studio_id=sess.studio_id for update;
 perform 1 from public.reservations where session_id=p_session and student_id=sid and studio_id=sess.studio_id and status in ('reserved','attended') for update;
 if not found then raise exception 'pole_reservation_required'; end if;
 if not exists(select 1 from public.pole_figure_profiles f join public.technical_elements e on e.id=f.element_id where f.element_id=fid and f.studio_id=sess.studio_id and f.discipline_id=discipline and e.active) or private.pole_state(sid,fid) not in ('disponible','autorizada','lograda') then raise exception 'pole_figure_locked'; end if;
 insert into public.student_pole_figure_achievements(studio_id,student_id,figure_element_id,source,marked_by,class_session_id,validated_at) values(sess.studio_id,sid,fid,'instructor',auth.uid(),p_session,now())
 on conflict(studio_id,student_id,figure_element_id) do update set source='instructor',marked_by=auth.uid(),class_session_id=p_session,validated_at=now();
 end loop;
end $$;
create or replace function private.pole_photo(p_figure uuid,p_path text,p_studio uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.students;
begin
 select * into s from public.students where user_id=auth.uid() and studio_id=p_studio and private.is_current_student(id,studio_id) for update;
 if s.id is null then raise exception 'forbidden'; end if;
 if p_path is not null and (p_path !~ ('^'||auth.uid()::text||'/'||p_figure::text||'/[0-9]+\.jpg$') or not exists(select 1 from storage.objects where bucket_id='pole-achievement-photos' and name=p_path)) then raise exception 'pole_photo_invalid'; end if;
 update public.student_pole_figure_achievements set photo_path=p_path where student_id=s.id and studio_id=s.studio_id and figure_element_id=p_figure;
 if not found then raise exception 'pole_achievement_required'; end if;
end $$;
create or replace function private.pole_save_plan(p_session uuid,p_level text,p_group text,p_sequence uuid[],p_new uuid,p_students uuid[]) returns void language plpgsql security definer set search_path='' as $$
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
 if not exists(select 1 from public.pole_figure_profiles f join public.technical_elements e on e.id=f.element_id where f.element_id=fid and f.studio_id=sess.studio_id and f.discipline_id=discipline and f.in_core_program and not f.requires_authorization and e.active and private.pole_rank(f.catalog_level)<=private.pole_rank(p_level) and (fid<>p_new or f.catalog_level=p_level)) then raise exception 'pole_plan_invalid'; end if;
 if fid<>p_new and private.pole_state(sid,fid)<>'lograda' then raise exception 'pole_plan_stale'; end if;
 end loop;
 end loop;
 insert into public.class_session_pole_plans(studio_id,class_session_id,catalog_level,group_key,sequence,new_figure_element_id,student_ids,created_by) values(sess.studio_id,p_session,p_level,p_group,p_sequence,p_new,expected,auth.uid())
 on conflict(studio_id,class_session_id,group_key) do update set sequence=excluded.sequence,new_figure_element_id=p_new,student_ids=expected,created_by=auth.uid(),created_at=now();
end $$;
create or replace function private.pole_edit(p_figure uuid,p_data jsonb,p_prerequisites uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare f public.pole_figure_profiles; l uuid; key text;
begin
 select * into f from public.pole_figure_profiles where element_id=p_figure;
 if auth.uid() is null or not private.has_capability(f.studio_id,'evaluations.configure') then raise exception 'forbidden'; end if;
 perform 1 from public.studios where id=f.studio_id for update;
 key:=case p_data->>'level' when 'principiante' then 'beginner' when 'intermedio' then 'intermediate' when 'avanzado' then 'advanced' end;
 select dl.id into l from public.discipline_technical_levels dl join public.technical_level_definitions d on d.id=dl.technical_level_id where dl.studio_id=f.studio_id and dl.discipline_id=f.discipline_id and d.level_key=key;
 update public.technical_elements set name=p_data->>'name',description=p_data->>'description',active=(p_data->>'active')::boolean where id=p_figure;
 update public.pole_figure_profiles set catalog_level=p_data->>'level',figure_type=p_data->>'type',requires_authorization=(p_data->>'level'='profesional'),discipline_technical_level_id=l where element_id=p_figure;
 delete from public.pole_figure_prerequisites where figure_element_id=p_figure;
 insert into public.pole_figure_prerequisites select f.studio_id,p_figure,x from unnest(p_prerequisites) x;
end $$;

-- Public API wrappers are invoker functions; all privileged work lives in private.
create function public.pole_figures_snapshot(p_student uuid,p_discipline uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.pole_snapshot(p_student,p_discipline); $$;
revoke all on function public.pole_figures_snapshot(uuid,uuid) from public,anon;
grant execute on function public.pole_figures_snapshot(uuid,uuid) to authenticated;
create function public.student_mark_pole_figure(p_figure uuid,p_studio uuid) returns void language sql security invoker set search_path='' as $$ select private.pole_mark(p_figure,true,p_studio); $$;
revoke all on function public.student_mark_pole_figure(uuid,uuid) from public,anon;
grant execute on function public.student_mark_pole_figure(uuid,uuid) to authenticated;
create function public.student_unmark_pole_figure(p_figure uuid,p_studio uuid) returns void language sql security invoker set search_path='' as $$ select private.pole_mark(p_figure,false,p_studio); $$;
revoke all on function public.student_unmark_pole_figure(uuid,uuid) from public,anon;
grant execute on function public.student_unmark_pole_figure(uuid,uuid) to authenticated;
create function public.staff_authorize_pole_figure(p_student uuid,p_figure uuid) returns void language sql security invoker set search_path='' as $$ select private.pole_authorize(p_student,p_figure,false); $$;
revoke all on function public.staff_authorize_pole_figure(uuid,uuid) from public,anon;
grant execute on function public.staff_authorize_pole_figure(uuid,uuid) to authenticated;
create function public.staff_revoke_pole_figure(p_student uuid,p_figure uuid) returns void language sql security invoker set search_path='' as $$ select private.pole_authorize(p_student,p_figure,true); $$;
revoke all on function public.staff_revoke_pole_figure(uuid,uuid) from public,anon;
grant execute on function public.staff_revoke_pole_figure(uuid,uuid) to authenticated;
create function public.staff_validate_pole_figures(p_session uuid,p_items jsonb) returns void language sql security invoker set search_path='' as $$ select private.pole_validate(p_session,p_items); $$;
revoke all on function public.staff_validate_pole_figures(uuid,jsonb) from public,anon;
grant execute on function public.staff_validate_pole_figures(uuid,jsonb) to authenticated;
create function public.student_set_pole_photo(p_figure uuid,p_path text,p_studio uuid) returns void language sql security invoker set search_path='' as $$ select private.pole_photo(p_figure,p_path,p_studio); $$;
revoke all on function public.student_set_pole_photo(uuid,text,uuid) from public,anon;
grant execute on function public.student_set_pole_photo(uuid,text,uuid) to authenticated;
create function public.staff_save_pole_plan(p_session uuid,p_level text,p_group text,p_sequence uuid[],p_new uuid,p_students uuid[]) returns void language sql security invoker set search_path='' as $$ select private.pole_save_plan(p_session,p_level,p_group,p_sequence,p_new,p_students); $$;
revoke all on function public.staff_save_pole_plan(uuid,text,text,uuid[],uuid,uuid[]) from public,anon;
grant execute on function public.staff_save_pole_plan(uuid,text,text,uuid[],uuid,uuid[]) to authenticated;
create function public.staff_edit_pole_figure(p_figure uuid,p_data jsonb,p_prerequisites uuid[]) returns void language sql security invoker set search_path='' as $$ select private.pole_edit(p_figure,p_data,p_prerequisites); $$;
revoke all on function public.staff_edit_pole_figure(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.staff_edit_pole_figure(uuid,jsonb,uuid[]) to authenticated;
revoke all on function private.pole_profile_guard() from public,anon,authenticated;
revoke all on function private.pole_prerequisite_guard() from public,anon,authenticated;
revoke all on function private.pole_audit() from public,anon,authenticated;
revoke all on function private.pole_level(uuid,uuid) from public,anon,authenticated;
revoke all on function private.pole_rank(text) from public,anon,authenticated;
revoke all on function private.pole_state(uuid,uuid) from public,anon,authenticated;
revoke all on function private.pole_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function private.pole_snapshot(uuid,uuid) to authenticated;
revoke all on function private.pole_mark(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function private.pole_mark(uuid,boolean,uuid) to authenticated;
revoke all on function private.pole_authorize(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.pole_authorize(uuid,uuid,boolean) to authenticated;
revoke all on function private.pole_validate(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.pole_validate(uuid,jsonb) to authenticated;
revoke all on function private.pole_photo(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.pole_photo(uuid,text,uuid) to authenticated;
revoke all on function private.pole_save_plan(uuid,text,text,uuid[],uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.pole_save_plan(uuid,text,text,uuid[],uuid,uuid[]) to authenticated;
revoke all on function private.pole_edit(uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function private.pole_edit(uuid,jsonb,uuid[]) to authenticated;
alter table public.pole_figure_profiles enable row level security;
alter table public.pole_figure_profiles force row level security;
revoke all on public.pole_figure_profiles from public,anon,authenticated;
grant select on public.pole_figure_profiles to authenticated;
create policy pole_figure_profiles_staff_read on public.pole_figure_profiles for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
alter table public.pole_figure_prerequisites enable row level security;
alter table public.pole_figure_prerequisites force row level security;
revoke all on public.pole_figure_prerequisites from public,anon,authenticated;
grant select on public.pole_figure_prerequisites to authenticated;
create policy pole_figure_prerequisites_staff_read on public.pole_figure_prerequisites for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
alter table public.student_pole_figure_achievements enable row level security;
alter table public.student_pole_figure_achievements force row level security;
revoke all on public.student_pole_figure_achievements from public,anon,authenticated;
grant select on public.student_pole_figure_achievements to authenticated;
create policy student_pole_figure_achievements_staff_read on public.student_pole_figure_achievements for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
create policy student_pole_figure_achievements_self_read on public.student_pole_figure_achievements for select to authenticated using(private.is_current_student(student_id,studio_id));
alter table public.student_pole_authorizations enable row level security;
alter table public.student_pole_authorizations force row level security;
revoke all on public.student_pole_authorizations from public,anon,authenticated;
grant select on public.student_pole_authorizations to authenticated;
create policy student_pole_authorizations_staff_read on public.student_pole_authorizations for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
create policy student_pole_authorizations_self_read on public.student_pole_authorizations for select to authenticated using(private.is_current_student(student_id,studio_id));
alter table public.class_session_pole_plans enable row level security;
alter table public.class_session_pole_plans force row level security;
revoke all on public.class_session_pole_plans from public,anon,authenticated;
grant select on public.class_session_pole_plans to authenticated;
create policy class_session_pole_plans_staff_read on public.class_session_pole_plans for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
alter table public.pole_figure_events enable row level security;
alter table public.pole_figure_events force row level security;
revoke all on public.pole_figure_events from public,anon,authenticated;
grant select on public.pole_figure_events to authenticated;
create policy pole_figure_events_staff_read on public.pole_figure_events for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
alter table public.pole_photo_cleanup enable row level security;
alter table public.pole_photo_cleanup force row level security;
revoke all on public.pole_photo_cleanup from public,anon,authenticated;
grant select on public.pole_photo_cleanup to authenticated;
create policy pole_photo_cleanup_staff_read on public.pole_photo_cleanup for select to authenticated using(private.has_capability(studio_id,'evaluations.read'));
create policy pole_photo_cleanup_self_read on public.pole_photo_cleanup for select to authenticated using(private.is_current_student(student_id,studio_id));

grant delete on public.pole_photo_cleanup to authenticated;
create policy pole_photo_cleanup_self_delete on public.pole_photo_cleanup for delete to authenticated using(private.is_current_student(student_id,studio_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pole-achievement-photos','pole-achievement-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy pole_photos_self_read on storage.objects for select to authenticated using(bucket_id='pole-achievement-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy pole_photos_staff_read on storage.objects for select to authenticated using(bucket_id='pole-achievement-photos' and exists(select 1 from public.student_pole_figure_achievements a where a.photo_path=name and private.has_capability(a.studio_id,'evaluations.read')));
create policy pole_photos_self_insert on storage.objects for insert to authenticated with check(bucket_id='pole-achievement-photos' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.student_pole_figure_achievements a where a.figure_element_id::text=(storage.foldername(name))[2] and private.is_current_student(a.student_id,a.studio_id)));
create policy pole_photos_self_update on storage.objects for update to authenticated using(bucket_id='pole-achievement-photos' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='pole-achievement-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy pole_photos_self_delete on storage.objects for delete to authenticated using(bucket_id='pole-achievement-photos' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
