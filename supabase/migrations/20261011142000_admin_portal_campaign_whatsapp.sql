create table private.campaign_whatsapp_readiness(studio_id uuid primary key references public.studios(id),template_name text not null,ready_until timestamptz not null);
revoke all on private.campaign_whatsapp_readiness from public,anon,authenticated;
create or replace function public.service_cache_campaign_whatsapp_readiness(p_studio_id uuid,p_actor uuid,p_template_name text,p_ready boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
if not exists(select 1 from public.studio_memberships m join public.role_capabilities c on c.role=m.role and c.capability_key='automations.manage' where m.studio_id=p_studio_id and m.user_id=p_actor and m.active) then raise exception 'forbidden';end if;
if p_ready and nullif(trim(p_template_name),'') is not null then
insert into private.campaign_whatsapp_readiness(studio_id,template_name,ready_until) values(p_studio_id,p_template_name,now()+interval '5 minutes') on conflict(studio_id) do update set template_name=excluded.template_name,ready_until=excluded.ready_until;
else delete from private.campaign_whatsapp_readiness where studio_id=p_studio_id;
end if;
end $$;
revoke all on function public.service_cache_campaign_whatsapp_readiness(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.service_cache_campaign_whatsapp_readiness(uuid,uuid,text,boolean) to service_role;
create or replace function public.admin_schedule_campaign(p_campaign_id uuid,p_scheduled_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare campaign public.notification_campaigns%rowtype;tz text;win text;local_time text;when_at timestamptz;
begin
 select * into campaign from public.notification_campaigns where id=p_campaign_id for update;
 if not found or not private.has_capability(campaign.studio_id,'automations.manage') then raise exception 'forbidden';end if;
 if campaign.status<>'draft' then raise exception 'campaign_readonly';end if;
 if campaign.channel_key='whatsapp' and (not exists(select 1 from private.campaign_whatsapp_readiness where studio_id=campaign.studio_id and ready_until>now()) or not exists(select 1 from public.notification_admin_settings where studio_id=campaign.studio_id and whatsapp_enabled) or not exists(select 1 from public.notification_studio_channel_providers where studio_id=campaign.studio_id and channel_key='whatsapp' and provider_key='meta_whatsapp' and enabled and is_default)) then raise exception 'campaign_whatsapp_template_required';end if;
 if campaign.channel_key='push' then
 if not exists(select 1 from public.notification_admin_settings where studio_id=campaign.studio_id and push_enabled) then raise exception 'campaign_push_unavailable';end if;
 begin perform public.service_get_push_vapid_config();exception when others then raise exception 'campaign_push_unavailable';end;
 end if;
 select timezone into tz from public.studios where id=campaign.studio_id;
 select coalesce(non_urgent_send_window,'08:00-21:00') into win from public.notification_admin_settings where studio_id=campaign.studio_id;
 win:=coalesce(win,'08:00-21:00');when_at:=coalesce(p_scheduled_at,now());
 if when_at<now()-interval '10 seconds' or when_at>now()+interval '365 days' then raise exception 'campaign_date_invalid';end if;
 local_time:=to_char(when_at at time zone tz,'HH24:MI');
 if (left(win,5)<right(win,5) and not(local_time>=left(win,5) and local_time<right(win,5))) or (left(win,5)>right(win,5) and not(local_time>=left(win,5) or local_time<right(win,5))) then raise exception 'campaign_outside_window';end if;
 if not exists(select 1 from private.portal_campaign_cohort(campaign.studio_id,campaign.audience_key) where eligible) then raise exception 'campaign_no_recipients';end if;
 update public.notification_campaigns set status='scheduled',scheduled_at=when_at,updated_at=now() where id=campaign.id;
end $$;
create or replace function private.notification_emit_campaigns_due()
returns integer language plpgsql security definer set search_path='' as $$
declare campaign public.notification_campaigns%rowtype;person record;v_rule_id uuid;event_id uuid;n integer:=0;
begin
 for campaign in select * from public.notification_campaigns where status='scheduled' and scheduled_at<=now() for update skip locked loop
 v_rule_id:=private.ensure_default_notification_rule(campaign.studio_id,'campaign.'||campaign.id::text,'campaign.manual_due','manual_campaign','normal','payload_student',jsonb_build_object('field','payload.campaign_id','operator','eq','value',campaign.id::text),'immediate','{}',null,'manual_campaign',86400,jsonb_build_array(jsonb_build_object('channel_key',campaign.channel_key,'is_required',true,'ordinal',0,'channel_policy',jsonb_build_object('title_template','{{studio_name}}','body_template',replace(campaign.message,'{nombre}','{{recipient_name}}')))));
 update public.notification_rule_versions v set communication_class='P2' where v.rule_id=v_rule_id;
 for person in select * from private.portal_campaign_cohort(campaign.studio_id,campaign.audience_key) loop
 event_id:=null;
 if person.eligible then
 event_id:=private.notification_try_emit_domain_event(campaign.studio_id,'campaign.manual_due','campaign',campaign.id,'notification:campaign:'||campaign.id::text||':'||person.student_id::text,jsonb_build_object('student_id',person.student_id,'campaign_id',campaign.id,'campaign_message',replace(campaign.message,'{nombre}',person.full_name)),campaign.created_by,clock_timestamp());
 if event_id is not null then n:=n+1;end if;
 end if;
 insert into public.notification_campaign_recipients(campaign_id,student_id,event_id,eligible) values(campaign.id,person.student_id,event_id,person.eligible) on conflict do nothing;
 end loop;
 update public.notification_campaigns set status='queued',queued_at=now(),updated_at=now() where id=campaign.id;
 end loop;
 return n;
end $$;

