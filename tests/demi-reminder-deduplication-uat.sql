begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $uat$
declare
  source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; fixture jsonb;
  studio uuid; student uuid; session uuid; alternate uuid; reservation uuid; alternate_reservation uuid;
  booking_rule uuid; reschedule_rule uuid; notice_rule uuid; rule uuid; version integer;
  reminder_type text; template text; start_time timestamptz; old_time timestamptz; alternate_time timestamptz;
  variables jsonb; channels jsonb; event_id uuid; event_five uuid; event_two uuid;
  original uuid; current_notification uuid; result jsonb; booked jsonb; cancelled integer;
  outcomes jsonb:='[]'; step integer; expected_created boolean; expected_jobs integer; key text;
begin
  if current_user<>'service_role' then raise exception 'incorrect_database_role'; end if;
  select user_id into owner from public.studio_memberships where studio_id=source and active and role='owner' limit 1;
  fixture:=public.service_create_demi_uat_run(source,owner,'reminder-deduplication-uat');
  studio:=(fixture->>'studio_id')::uuid;
  student:=(fixture#>>'{fixtures,people,student_active,student_id}')::uuid;
  session:=(fixture#>>'{fixtures,sessions,available}')::uuid;
  alternate:=(fixture#>>'{fixtures,sessions,alternative}')::uuid;
  start_time:=date_trunc('second',clock_timestamp()+interval '3 days'); old_time:=start_time;
  alternate_time:=start_time+interval '1 day';
  update public.class_sessions set starts_at=start_time,ends_at=start_time+interval '1 hour' where id=session and studio_id=studio;
  update public.class_sessions set starts_at=alternate_time,ends_at=alternate_time+interval '1 hour' where id=alternate and studio_id=studio;
  booked:=public.service_book_student(studio,session,student);
  if not coalesce((booked->>'eligible')::boolean,false) then raise exception 'booking_fixture:%',booked; end if;
  select id into reservation from public.reservations where studio_id=studio and student_id=student and session_id=session and status='reserved';
  booked:=public.service_book_student(studio,alternate,student);
  if not coalesce((booked->>'eligible')::boolean,false) then raise exception 'alternate_fixture:%',booked; end if;
  select id into alternate_reservation from public.reservations where studio_id=studio and student_id=student and session_id=alternate and status='reserved';
  select id into booking_rule from public.notification_rules where studio_id=studio and rule_key='p0.booking.class_reminder_5h';
  select id into reschedule_rule from public.notification_rules where studio_id=studio and rule_key='p0.session.rescheduled_reminder_5h';
  select id into notice_rule from public.notification_rules where studio_id=studio and rule_key='p0.session.rescheduled_notice';
  if booking_rule is null or reschedule_rule is null or notice_rule is null then raise exception 'missing_rules'; end if;

  for step in 1..11 loop
    rule:=case when step in (1,7,9) then booking_rule else reschedule_rule end;
    variables:=jsonb_build_object('reservation_id',reservation,'session_id',session,'session_starts_at',start_time);
    channels:='[{"channel_key":"inbox","is_required":true},{"channel_key":"whatsapp","is_required":true}]';
    expected_created:=false; expected_jobs:=0;
    if step=1 then channels:='[{"channel_key":"inbox","is_required":true}]'; expected_created:=true; expected_jobs:=1; end if;
    if step=2 then channels:='[{"channel_key":"inbox","is_required":true}]'; end if;
    if step=3 then
      channels:='[{"channel_key":"inbox","is_required":true}]';
      variables:=jsonb_set(variables,'{session_starts_at}',to_jsonb(to_char(start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z'));
    end if;
    if step=4 then expected_jobs:=1; end if;
    if step=5 then
      start_time:=start_time+interval '1 hour';
      update public.class_sessions set starts_at=start_time,ends_at=start_time+interval '1 hour' where id=session and studio_id=studio;
      cancelled:=public.system_cancel_pending_notifications_for_session(studio,session,'session_rescheduled','UAT real time change');
      if cancelled<>2 or not exists(select 1 from public.notifications where id=original and state='cancelled') then raise exception 'old_reminder_not_cancelled:%',cancelled; end if;
      variables:=jsonb_set(variables,'{session_starts_at}',to_jsonb(start_time));
      expected_created:=true; expected_jobs:=2;
    end if;
    if step=6 then
      cancelled:=public.system_cancel_pending_notifications_for_session(studio,session,'session_rescheduled','UAT replay');
      if cancelled<>0 or not exists(select 1 from public.notifications where id=current_notification and state='active') then raise exception 'reschedule_replay_cancelled_current:%',cancelled; end if;
    end if;
    if step=8 then variables:=jsonb_set(variables,'{session_starts_at}',to_jsonb(old_time)); expected_created:=true; end if;
    if step=9 then
      variables:=jsonb_build_object('reservation_id',alternate_reservation,'session_id',alternate,'session_starts_at',alternate_time);
      expected_created:=true; expected_jobs:=2;
    end if;
    if step=10 then rule:=notice_rule; expected_created:=true; expected_jobs:=2; end if;
    if step=11 then expected_created:=true; end if;
    select r.current_version_number,rv.notification_type,rv.template_key into version,reminder_type,template
      from public.notification_rules r join public.notification_rule_versions rv on rv.rule_id=r.id and rv.studio_id=r.studio_id and rv.version_number=r.current_version_number
      where r.id=rule and r.studio_id=studio;
    event_id:=gen_random_uuid(); key:='uat:reminder:'||step;
    if step=3 then event_id:=event_two; key:='uat:reminder:2'; end if;
    if step=6 then event_id:=event_five; key:='uat:reminder:5'; end if;
    if step not in (3,6) then
      insert into public.domain_events(event_id,studio_id,event_type,source_entity_type,source_entity_id,deduplication_key,payload)
      select event_id,studio,event_type,case when rule=booking_rule then 'reservation' else 'class_session' end,
        case when rule=booking_rule then (variables->>'reservation_id')::uuid else session end,key,
        jsonb_build_object('session_id',variables->>'session_id','reservation_id',variables->>'reservation_id')
      from public.notification_rules where id=rule;
    end if;
    if step=2 then event_two:=event_id; end if;
    if step=5 then event_five:=event_id; end if;
    select to_jsonb(x) into result from public.system_materialize_notification(
      p_studio_id=>studio,p_source_event_id=>event_id,p_rule_id=>rule,p_rule_version_number=>version,
      p_notification_type=>reminder_type,p_communication_class=>'P0',p_recipient_type=>'student',
      p_recipient_entity_id=>student,p_recipient_user_id=>null,p_recipient_snapshot=>jsonb_build_object('full_name','UAT reminder'),
      p_priority=>'normal',p_scheduled_for=>case when step=9 then alternate_time else start_time end-interval '6 hours',
      p_expires_at=>case when step=9 then alternate_time else start_time end,
      p_template_key=>template,p_template_variables=>variables,p_deduplication_key=>key,p_channels=>case when step=11 then '[]'::jsonb else channels end,
      p_suppressed=>step=11,p_reason_code=>case when step=11 then 'scheduled_time_elapsed' else null end
    ) x;
    if (result->>'created')::boolean is distinct from expected_created or (result->>'jobs_created')::integer is distinct from expected_jobs then
      raise exception 'step_%_expected_%_jobs_%:%',step,expected_created,expected_jobs,result;
    end if;
    if step=1 then original:=(result->>'notification_id')::uuid; current_notification:=original; end if;
    if step=5 then current_notification:=(result->>'notification_id')::uuid; end if;
    if step in (2,3,4,6,7) and (result->>'notification_id')::uuid is distinct from current_notification then raise exception 'logical_reminder_id_changed:%',step; end if;
    if step=8 and not exists(select 1 from public.notifications where id=(result->>'notification_id')::uuid and state='suppressed' and state_reason_code='reminder_snapshot_obsolete') then raise exception 'stale_snapshot_not_suppressed'; end if;
    if step=11 and not exists(select 1 from public.notifications where id=(result->>'notification_id')::uuid and state='suppressed' and state_reason_code='scheduled_time_elapsed') then raise exception 'timing_suppression_changed'; end if;
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('step',step,'variant',(array[
      'first_rule_creates_one_reminder','second_rule_reuses_same_reminder','replay_and_equivalent_utc_timestamp',
      'missing_configured_channel_added_once','real_reschedule_replaces_old_reminder','replayed_reschedule_keeps_current_reminder',
      'delayed_booking_event_reuses_current_slot','stale_snapshot_cannot_create_delivery','other_reservation_is_independent',
      'reschedule_notice_remains_independent','existing_timing_suppression_preserved'])[step],'passed',true));
  end loop;
  if (select count(*) from public.notification_jobs where notification_id=current_notification)<>2
     or exists(select channel_key from public.notification_jobs where notification_id=current_notification group by channel_key having count(*)<>1)
     or (select count(*) from public.notifications where studio_id=studio and notification_type='class_reminder_5h' and state='active' and template_variables->>'reservation_id'=reservation::text)<>1
  then raise exception 'final_duplicate_reminder_or_channel_job'; end if;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('variant','one_active_reminder_one_job_per_channel','passed',true));
  perform set_config('uat.reminder_deduplication',outcomes::text,true);
end; $uat$;
select current_setting('uat.reminder_deduplication')::jsonb as results;
rollback;
