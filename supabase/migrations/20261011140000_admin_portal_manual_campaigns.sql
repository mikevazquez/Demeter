create table public.notification_campaigns (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 name text not null, audience_key text not null check(audience_key in ('all_eligible','active_students','inactive_students','package_expiring','package_expired','trial_no_purchase')),
 channel_key text not null check(channel_key in ('inbox','push','whatsapp')), message text not null,
 status text not null default 'draft' check(status in ('draft','scheduled','queued')),
 scheduled_at timestamptz, queued_at timestamptz, created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index notification_campaigns_studio_idx on public.notification_campaigns(studio_id,created_at desc);
create index notification_campaigns_creator_idx on public.notification_campaigns(created_by);
create table public.notification_campaign_recipients (
 campaign_id uuid not null references public.notification_campaigns(id),student_id uuid not null references public.students(id),
 event_id uuid references public.domain_events(event_id),eligible boolean not null,primary key(campaign_id,student_id)
);
create index notification_campaign_recipients_student_idx on public.notification_campaign_recipients(student_id);
create index notification_campaign_recipients_event_idx on public.notification_campaign_recipients(event_id);
alter table public.notification_campaigns enable row level security;
alter table public.notification_campaign_recipients enable row level security;
grant select on public.notification_campaigns,public.notification_campaign_recipients to authenticated;
create policy campaigns_read on public.notification_campaigns for select to authenticated using(private.has_capability(studio_id,'automations.read'));
create policy campaign_recipients_read on public.notification_campaign_recipients for select to authenticated using(exists(select 1 from public.notification_campaigns c where c.id=campaign_id and private.has_capability(c.studio_id,'automations.read')));

create or replace function private.portal_campaign_cohort(p_studio uuid,p_segment text)
returns table(student_id uuid,full_name text,eligible boolean) language sql stable security definer set search_path='' as $$
 with context as (
 select s.*, (now() at time zone st.timezone)::date as today,
 coalesce(cp.promotions_enabled,true) and not coalesce(cp.whatsapp_blocked,false) as opted_in,
 exists(select 1 from public.product_acquisitions a where a.studio_id=s.studio_id and a.student_id=s.id and a.status='active' and a.refunded_at is null and not a.access_blocked and a.starts_on<=(now() at time zone st.timezone)::date and a.expires_on>=(now() at time zone st.timezone)::date) as current_package,
 (select max(a.expires_on) from public.product_acquisitions a where a.studio_id=s.studio_id and a.student_id=s.id and a.status='active' and a.refunded_at is null) as last_expiry,
 (select max(cs.starts_at) from public.reservations r join public.class_sessions cs on cs.id=r.session_id where r.student_id=s.id and r.studio_id=s.studio_id and r.status='attended') as last_attendance
 from public.students s join public.studios st on st.id=s.studio_id left join public.person_communication_preferences cp on cp.studio_id=s.studio_id and cp.person_id=s.person_id
 where s.studio_id=p_studio and s.active and s.lifecycle_status='active'
 ) select c.id,c.full_name,c.opted_in from context c where
 p_segment='all_eligible' or (p_segment='active_students' and c.current_package)
 or (p_segment='inactive_students' and c.current_package and (c.last_attendance is null or c.last_attendance<now()-interval '14 days'))
 or (p_segment='package_expiring' and c.current_package and (c.last_expiry<=c.today+7 or exists(select 1 from public.product_acquisitions a where a.student_id=c.id and a.studio_id=p_studio and a.status='active' and a.refunded_at is null and not a.unlimited and a.starts_on<=c.today and a.expires_on>=c.today and (select coalesce(sum(l.quantity),0) from public.credit_ledger l where l.acquisition_id=a.id)<=1)))
 or (p_segment='package_expired' and not c.current_package and c.last_expiry<c.today)
 or (p_segment='trial_no_purchase' and c.trial_status='attended' and not exists(select 1 from public.student_enrollments e where e.student_id=c.id and e.studio_id=p_studio and e.status='active' and e.starts_on<=c.today and (e.expires_on is null or e.expires_on>=c.today)));
$$;
revoke all on function private.portal_campaign_cohort(uuid,text) from public,anon,authenticated;

create or replace function public.admin_campaign_audience(p_studio_id uuid,p_segment text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_capability(p_studio_id,'automations.read') then raise exception 'forbidden';end if;
 select jsonb_build_object('total',count(*),'eligible',count(*) filter(where eligible),'sample',min(full_name) filter(where eligible)) into result from private.portal_campaign_cohort(p_studio_id,p_segment);
 return result;
end $$;
create or replace function public.admin_save_campaign(p_studio_id uuid,p_campaign_id uuid,p_name text,p_segment text,p_channel text,p_message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare campaign public.notification_campaigns%rowtype;result uuid;
begin
 if not private.has_capability(p_studio_id,'automations.manage') then raise exception 'forbidden';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'campaign_name_required';end if;
 if length(trim(coalesce(p_message,''))) not between 10 and 1024 then raise exception 'campaign_message_invalid';end if;
 if p_campaign_id is not null then
 select * into campaign from public.notification_campaigns where id=p_campaign_id and studio_id=p_studio_id for update;
 if not found or campaign.status<>'draft' then raise exception 'campaign_readonly';end if;
 update public.notification_campaigns set name=trim(p_name),audience_key=p_segment,channel_key=p_channel,message=trim(p_message),updated_at=now() where id=campaign.id returning id into result;
 else
 insert into public.notification_campaigns(studio_id,name,audience_key,channel_key,message,created_by) values(p_studio_id,trim(p_name),p_segment,p_channel,trim(p_message),(select auth.uid())) returning id into result;
 end if;
 return result;
end $$;
create or replace function public.admin_schedule_campaign(p_campaign_id uuid,p_scheduled_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare campaign public.notification_campaigns%rowtype;tz text;win text;local_time text;when_at timestamptz;
begin
 select * into campaign from public.notification_campaigns where id=p_campaign_id for update;
 if not found or not private.has_capability(campaign.studio_id,'automations.manage') then raise exception 'forbidden';end if;
 if campaign.status<>'draft' then raise exception 'campaign_readonly';end if;
 if campaign.channel_key='whatsapp' then raise exception 'campaign_whatsapp_template_required';end if;
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
create or replace function public.admin_cancel_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare campaign public.notification_campaigns%rowtype;
begin
 select * into campaign from public.notification_campaigns where id=p_campaign_id for update;
 if not found or not private.has_capability(campaign.studio_id,'automations.manage') then raise exception 'forbidden';end if;
 if campaign.status<>'scheduled' then raise exception 'campaign_already_queued';end if;
 update public.notification_campaigns set status='draft',scheduled_at=null,updated_at=now() where id=campaign.id;
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
 event_id:=private.notification_try_emit_domain_event(campaign.studio_id,'campaign.manual_due','campaign',campaign.id,'notification:campaign:'||campaign.id::text||':'||person.student_id::text,jsonb_build_object('student_id',person.student_id,'campaign_id',campaign.id),campaign.created_by,clock_timestamp());
 if event_id is not null then n:=n+1;end if;
 end if;
 insert into public.notification_campaign_recipients(campaign_id,student_id,event_id,eligible) values(campaign.id,person.student_id,event_id,person.eligible) on conflict do nothing;
 end loop;
 update public.notification_campaigns set status='queued',queued_at=now(),updated_at=now() where id=campaign.id;
 end loop;
 return n;
end $$;
revoke all on function private.notification_emit_campaigns_due() from public,anon,authenticated;
revoke all on function public.admin_campaign_audience(uuid,text),public.admin_save_campaign(uuid,uuid,text,text,text,text),public.admin_schedule_campaign(uuid,timestamptz),public.admin_cancel_campaign(uuid) from public,anon;
grant execute on function public.admin_campaign_audience(uuid,text),public.admin_save_campaign(uuid,uuid,text,text,text,text),public.admin_schedule_campaign(uuid,timestamptz),public.admin_cancel_campaign(uuid) to authenticated;
select cron.schedule('studio_flow_campaigns_due','* * * * *','select private.notification_emit_campaigns_due();');
