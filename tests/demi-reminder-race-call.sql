-- Prefix with BEGIN; and SET LOCAL uat.reminder_race_worker='a' (or 'b').
-- Default hold: three seconds. The one-off background mode observes locks for ten.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare f jsonb; worker text:=current_setting('uat.reminder_race_worker'); result jsonb; started timestamptz:=clock_timestamp(); returned timestamptz; observations jsonb:='[]'; observed jsonb; i integer;
begin
  if worker not in ('a','b') then raise exception 'invalid_race_worker'; end if;
  select a.payload into strict f from public.demi_uat_runs r join public.demi_uat_artifacts a on a.run_id=r.id and a.kind='reminder_race_fixture'
    where r.baseline->>'commit'='reminder-race-uat' and r.faults->>'reminder_race_closed'='false';
  select to_jsonb(x) into result from public.system_materialize_notification(
    p_studio_id=>(f->>'studio_id')::uuid,p_source_event_id=>(f->>('event_'||worker))::uuid,
    p_rule_id=>(f#>>array['rules',worker,'rule'])::uuid,p_rule_version_number=>(f#>>array['rules',worker,'version'])::integer,
    p_notification_type=>'class_reminder_5h',p_communication_class=>'P0',p_recipient_type=>'student',
    p_recipient_entity_id=>(f->>'student_id')::uuid,p_recipient_user_id=>null,p_recipient_snapshot=>'{"full_name":"UAT race"}',
    p_priority=>'normal',p_scheduled_for=>(f->>'scheduled_for')::timestamptz,p_expires_at=>(f->>'starts_at')::timestamptz,
    p_template_key=>'class_reminder',p_template_variables=>jsonb_build_object('reservation_id',f->>'reservation_id','session_id',f->>'session_id','session_starts_at',f->>'starts_at'),
    p_deduplication_key=>'uat:race:'||worker,p_channels=>'[{"channel_key":"inbox","is_required":true},{"channel_key":"whatsapp","is_required":true}]'
  ) x;
  returned:=clock_timestamp();
  result:=result||jsonb_build_object('database_role',current_user);
  if current_setting('uat.reminder_race_background',true)='true' then
    for i in 1..5 loop
      perform pg_sleep(2);
      -- Observe locks as the administrative session, outside the tested RPC role.
      execute 'reset role';
      select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event)),'[]'::jsonb) into observed
        from pg_stat_activity where pid<>pg_backend_pid() and query like '%demi-reminder-race:foreground%';
      observations:=observations||observed;
      execute 'set local role service_role';
    end loop;
  else
    perform pg_sleep(3);
  end if;
  perform set_config('uat.reminder_race_result',(result||jsonb_build_object('worker',worker,'started_at',started,'returned_at',returned,'completed_at',clock_timestamp(),'txid',txid_current(),'lock_observations',observations))::text,true);
end; $uat$;
insert into public.demi_uat_artifacts(run_id,kind,payload)
  select id,'reminder_race_call',current_setting('uat.reminder_race_result')::jsonb from public.demi_uat_runs
  where baseline->>'commit'='reminder-race-uat' and faults->>'reminder_race_closed'='false';
select current_setting('uat.reminder_race_result')::jsonb as result;
commit;
