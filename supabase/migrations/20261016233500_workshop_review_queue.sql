-- Sandbox: tenant-scoped review queue; no direct table grants.
create or replace function public.admin_workshop_provisional_review_queue(p_studio_id uuid,p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_rows jsonb;
begin
 if v_actor is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'sales.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.read'),false)
 or not exists(select 1 from public.user_accounts where id=v_actor and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active')
 then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_offers where studio_id=p_studio_id and id=p_offer_id)
 then raise exception 'offer_not_found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',h.id,'student_id',h.student_id,'student_name',s.full_name,
 'transfer_reference',h.transfer_reference,'amount_minor',h.amount_minor,
 'total_minor',h.total_minor,'expires_at',h.expires_at,
 'session_count',(select count(*) from public.workshop_provisional_hold_sessions hs where hs.hold_id=h.id)
 ) order by h.created_at,h.id),'[]'::jsonb)
 into v_rows
 from public.workshop_provisional_holds h
 join public.students s on s.id=h.student_id and s.studio_id=p_studio_id
 where h.studio_id=p_studio_id and h.offer_id=p_offer_id
 and h.state='reserved_provisionally' and h.expires_at>now();
 return v_rows;
end $$;
revoke all on function public.admin_workshop_provisional_review_queue(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_workshop_provisional_review_queue(uuid,uuid) to authenticated;
