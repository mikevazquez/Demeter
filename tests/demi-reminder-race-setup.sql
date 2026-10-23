-- Sandbox only. Creates a committed synthetic fixture so two DB sessions can race.
-- Run cleanup after both calls. No worker or external delivery is invoked.
begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare
  source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; fixture jsonb;
  studio uuid; run uuid; student uuid; session uuid; reservation uuid; booked jsonb;
  starts timestamptz:=date_trunc('second',clock_timestamp()+interval '3 days');
  event_a uuid:=gen_random_uuid(); event_b uuid:=gen_random_uuid(); rules jsonb;
begin
  if exists(select 1 from public.demi_uat_runs where baseline->>'commit'='reminder-race-uat' and faults->>'reminder_race_closed' is distinct from 'true') then raise exception 'existing_unclosed_reminder_race'; end if;
  select user_id into owner from public.studio_memberships where studio_id=source and active and role='owner' limit 1;
  fixture:=public.service_create_demi_uat_run(source,owner,'reminder-race-uat');
  studio:=(fixture->>'studio_id')::uuid;
  select id into run from public.demi_uat_runs where studio_id=studio;
  student:=(fixture#>>'{fixtures,people,student_active,student_id}')::uuid;
  session:=(fixture#>>'{fixtures,sessions,available}')::uuid;
  update public.class_sessions set starts_at=starts,ends_at=starts+interval '1 hour' where id=session and studio_id=studio;
  booked:=public.service_book_student(studio,session,student);
  if not coalesce((booked->>'eligible')::boolean,false) then raise exception 'race_booking:%',booked; end if;
  select id into reservation from public.reservations where studio_id=studio and student_id=student and session_id=session and status='reserved';
  select jsonb_object_agg(case when rule_key='p0.booking.class_reminder_5h' then 'a' else 'b' end,jsonb_build_object('rule',id,'version',current_version_number)) into rules
    from public.notification_rules where studio_id=studio and rule_key in ('p0.booking.class_reminder_5h','p0.session.rescheduled_reminder_5h');
  if rules->'a' is null or rules->'b' is null then raise exception 'race_rules_missing'; end if;
  insert into public.domain_events(event_id,studio_id,event_type,source_entity_type,source_entity_id,deduplication_key,payload)
  values(event_a,studio,'uat.reminder_race_a','reservation',reservation,'uat:race:a',jsonb_build_object('session_id',session)),
    (event_b,studio,'uat.reminder_race_b','class_session',session,'uat:race:b',jsonb_build_object('session_id',session));
  -- Exclude only this fixture's events from the automatic engine during the race.
  update public.notification_event_processings set available_at=clock_timestamp()+interval '7 days' where studio_id=studio;
  update public.demi_uat_runs set faults=faults||jsonb_build_object('reminder_race_closed',false) where id=run;
  fixture:=jsonb_build_object('run_id',run,'studio_id',studio,'student_id',student,'session_id',session,'reservation_id',reservation,
    'starts_at',starts,'scheduled_for',starts-interval '6 hours','event_a',event_a,'event_b',event_b,'rules',rules);
  insert into public.demi_uat_artifacts(run_id,kind,payload) values(run,'reminder_race_fixture',fixture);
  perform set_config('uat.reminder_race_fixture',fixture::text,true);
end; $uat$;
select current_setting('uat.reminder_race_fixture')::jsonb as fixture;
commit;
