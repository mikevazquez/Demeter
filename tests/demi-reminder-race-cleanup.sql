begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare run uuid; studio uuid; audit jsonb;
begin
  select id,studio_id into strict run,studio from public.demi_uat_runs
    where baseline->>'commit'='reminder-race-uat' and faults->>'reminder_race_closed'='false';
  -- Remove only this fixture's one-off background session, even if it failed.
  execute 'reset role';
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname='uat-demi-reminder-race-'||left(run::text,8);
  execute 'set local role service_role';
  select jsonb_build_object('run_id',run,'studio_id',studio,'active_reminders',count(*),
    'jobs',(select count(*) from public.notification_jobs where studio_id=studio),
    'deliveries',(select count(*) from public.notification_deliveries where studio_id=studio),
    'duplicate_channels',(select count(*) from (select notification_id,channel_key from public.notification_jobs where studio_id=studio group by notification_id,channel_key having count(*)>1) d)) into audit
    from public.notifications where studio_id=studio and state='active' and notification_type='class_reminder_5h';
  -- Preserve the fixture and audit, but cancel all future activity in this tenant.
  update public.class_sessions set status='cancelled' where studio_id=studio and status='scheduled';
  update public.notification_jobs set state='cancelled',state_reason_code='uat_closed',state_actor_type='system',
    lease_owner=null,lease_acquired_at=null,lease_expires_at=null,next_attempt_at=null,completed_at=coalesce(completed_at,clock_timestamp())
    where studio_id=studio and state in ('ready','scheduled','processing','retry_wait');
  update public.notifications set state='cancelled',state_reason_code='uat_closed',cancelled_at=coalesce(cancelled_at,clock_timestamp()) where studio_id=studio and state='active';
  update public.notification_event_processings set state='dead_letter',last_error_code='uat_closed',
    last_error_safe='Controlled race fixture closed without automatic dispatch.',lease_owner=null,lease_acquired_at=null,lease_expires_at=null,completed_at=clock_timestamp()
    where studio_id=studio and state in ('pending','processing','retry_wait');
  update public.demi_uat_runs set faults=faults||jsonb_build_object('reminder_race_closed',true),lease_until=null where id=run;
  audit:=audit||jsonb_build_object('active_jobs_after',(select count(*) from public.notification_jobs where studio_id=studio and state in ('ready','scheduled','processing','retry_wait')),
    'active_notifications_after',(select count(*) from public.notifications where studio_id=studio and state='active'),
    'pending_event_processing_after',(select count(*) from public.notification_event_processings where studio_id=studio and state in ('pending','processing','retry_wait')));
  insert into public.demi_uat_artifacts(run_id,kind,payload) values(run,'reminder_race_audit',audit);
  perform set_config('uat.reminder_race_audit',audit::text,true);
end; $uat$;
select current_setting('uat.reminder_race_audit')::jsonb as audit;
commit;
