create or replace function public.admin_unschedule_document_version(p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.document_versions%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 select * into v from public.document_versions where id=p_version_id for update;
 if not found then raise exception 'document_version_not_found'; end if;
 if not private.has_capability(v.studio_id,'documents.manage') then raise exception 'forbidden'; end if;
 if v.status<>'scheduled' or v.effective_at<=now() then raise exception 'document_unschedule_not_allowed'; end if;
 update public.document_versions set status='draft',published_at=null,updated_at=now() where id=v.id;
 insert into public.document_audit_events(studio_id,document_id,version_id,event_type,actor_user_id,details)
 values(v.studio_id,v.document_id,v.id,'publication_unscheduled',(select auth.uid()),jsonb_build_object('previous_effective_at',v.effective_at));
end; $$;
revoke all on function public.admin_unschedule_document_version(uuid) from public,anon;
grant execute on function public.admin_unschedule_document_version(uuid) to authenticated;
