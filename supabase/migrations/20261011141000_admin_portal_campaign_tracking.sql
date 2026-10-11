create or replace function public.admin_campaign_tracking(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare campaign public.notification_campaigns%rowtype;result jsonb;
begin
 select * into campaign from public.notification_campaigns where id=p_campaign_id;
 if not found or not private.has_capability(campaign.studio_id,'automations.read') then raise exception 'forbidden';end if;
 select jsonb_build_object('total',count(*),'eligible',count(*) filter(where r.eligible),
 'sent',count(*) filter(where exists(select 1 from public.notification_deliveries d where d.source_event_id=r.event_id and d.state in ('accepted','delivered'))),
 'pending',count(*) filter(where r.event_id is not null and not exists(select 1 from public.notifications n where n.source_event_id=r.event_id and n.state in ('completed','partially_completed','suppressed','cancelled','failed'))),
 'responded',count(*) filter(where exists(select 1 from public.assistant_conversations c join public.assistant_turns t on t.conversation_id=c.id where c.student_id=r.student_id and c.studio_id=campaign.studio_id and t.role='user' and t.created_at>=campaign.queued_at)),
 'purchased',count(*) filter(where exists(select 1 from public.sales s where s.student_id=r.student_id and s.studio_id=campaign.studio_id and s.status='confirmed' and s.created_at>=campaign.queued_at and exists(select 1 from public.payments p where p.sale_id=s.id and p.kind='payment' and p.amount_minor>0))))
 into result from public.notification_campaign_recipients r where r.campaign_id=campaign.id;
 return result;
end $$;
revoke all on function public.admin_campaign_tracking(uuid) from public,anon;
grant execute on function public.admin_campaign_tracking(uuid) to authenticated;
