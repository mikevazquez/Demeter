create function public.service_revalidate_demi_followup(p_id uuid,p_token uuid,p_now timestamptz default clock_timestamp())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.demi_followups%rowtype; reason text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into f from public.demi_followups where id=p_id for update;
 if not found or f.state<>'processing' or f.lease_token is distinct from p_token or f.lease_until<=p_now then return jsonb_build_object('eligible',false,'reason_code','lease_mismatch'); end if;
 reason:=private.demi_followup_stop_reason(f,p_now);
 if reason is not null then
  update public.demi_followups set state='cancelled',reason_code=reason,lease_token=null,lease_until=null where id=f.id;
 end if;
 return jsonb_build_object('eligible',reason is null,'reason_code',reason);
end; $$;

create function public.service_seed_due_demi_followups(p_studio uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security invoker set search_path='' as $$
declare item record; c uuid; today date; timezone text; count integer:=0; anchor timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.demi_followup_settings where studio_id=p_studio and enabled) then return 0; end if;
 select s.timezone,(p_now at time zone s.timezone)::date into timezone,today from public.studios s where id=p_studio;
 for item in select a.* from public.product_acquisitions a where a.studio_id=p_studio and a.refunded_at is null and a.status<>'cancelled' and a.expires_on between today-31 and today+3 loop
  select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
  if c is null then continue; end if;
  anchor:=(item.expires_on+time '10:00') at time zone timezone;
  if item.expires_on>=today then perform public.service_schedule_demi_followups(p_studio,c,'package_expiring',item.id::text,anchor); end if;
  if item.expires_on<today then
   perform public.service_schedule_demi_followups(p_studio,c,'package_expired',item.id::text,anchor);
   perform public.service_schedule_demi_followups(p_studio,c,'package',item.id::text,anchor);
  end if;
  count:=count+1;
 end loop;
 for item in select * from public.student_enrollments where studio_id=p_studio and refunded_at is null and status in ('active','expired') and expires_on between today-31 and today-1 loop
  select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
  if c is null then continue; end if;
  perform public.service_schedule_demi_followups(p_studio,c,'enrollment',item.id::text,(item.expires_on+time '10:00') at time zone timezone);
  count:=count+1;
 end loop;
 for item in select r.student_id,max(s.starts_at) as last_attended from public.reservations r join public.class_sessions s on s.id=r.session_id and s.studio_id=r.studio_id where r.studio_id=p_studio and r.status='attended' group by r.student_id loop
  if item.last_attended+interval '14 days'>p_now then continue; end if;
  select id into c from public.assistant_conversations where studio_id=p_studio and student_id=item.student_id and channel='whatsapp' order by last_activity_at desc limit 1;
  if c is null then continue; end if;
  perform public.service_schedule_demi_followups(p_studio,c,'inactive',item.last_attended::text,item.last_attended);
  count:=count+1;
 end loop;
 return count;
end; $$;

create function private.stop_demi_followups_on_operation() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid; reason text;
begin
 if tg_table_name='reservations' then
  if new.status not in ('reserved','attended') then return new; end if;
  reason:=case when new.status='attended' then 'attendance_recorded' else 'reservation_exists' end;
 else
  if new.status<>'active' or new.refunded_at is not null then return new; end if;
  reason:=case when tg_table_name='student_enrollments' then 'enrollment_renewed' else 'package_renewed' end;
 end if;
 select person_id into person from public.students where id=new.student_id and studio_id=new.studio_id;
 update public.demi_followups set state='cancelled',reason_code=reason,lease_token=null,lease_until=null
 where studio_id=new.studio_id and person_id=person and state in ('pending','processing')
 and (tg_table_name='reservations' or (tg_table_name='student_enrollments' and kind='enrollment') or (tg_table_name='product_acquisitions' and kind in ('package','package_expiring','package_expired')));
 return new;
end; $$;
create trigger demi_followups_reservation_stop after insert or update of status on public.reservations for each row execute function private.stop_demi_followups_on_operation();
create trigger demi_followups_enrollment_stop after insert or update of status,expires_on on public.student_enrollments for each row execute function private.stop_demi_followups_on_operation();
create trigger demi_followups_package_stop after insert or update of status on public.product_acquisitions for each row execute function private.stop_demi_followups_on_operation();

create function private.seed_demi_uat_followups() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.demi_followup_settings(studio_id,enabled) values(new.studio_id,true) on conflict do nothing;
 return new;
end; $$;
create trigger demi_uat_followup_settings after insert on public.demi_uat_runs for each row execute function private.seed_demi_uat_followups();

revoke all on function public.service_revalidate_demi_followup(uuid,uuid,timestamptz),public.service_seed_due_demi_followups(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.service_revalidate_demi_followup(uuid,uuid,timestamptz),public.service_seed_due_demi_followups(uuid,timestamptz) to service_role;
revoke all on function private.stop_demi_followups_on_operation(),private.seed_demi_uat_followups() from public,anon,authenticated,service_role;
