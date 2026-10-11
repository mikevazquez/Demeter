create or replace function public.admin_document_history(p_studio_id uuid,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_capability(p_studio_id,'documents.read') then raise exception 'forbidden';end if;
 select coalesce(jsonb_agg(to_jsonb(row) order by row.occurred_at desc),'[]') into result from (
 select e.id,e.event_type,e.occurred_at,e.student_id,s.full_name as student_name,d.name as document_name,
 coalesce(nullif(p.full_name,''),'Integrante') as actor_name,
 coalesce(e.details->>'reason',e.details->>'note',e.details->>'resolution_note','') as reason
 from public.document_audit_events e left join public.students s on s.id=e.student_id and s.studio_id=e.studio_id
 left join public.studio_documents d on d.id=e.document_id and d.studio_id=e.studio_id
 left join public.profiles p on p.id=e.actor_user_id where e.studio_id=p_studio_id
 order by e.occurred_at desc limit least(greatest(coalesce(p_limit,100),1),200)
 ) row;
 return result;
end $$;
revoke all on function public.admin_document_history(uuid,integer) from public,anon;
grant execute on function public.admin_document_history(uuid,integer) to authenticated;
