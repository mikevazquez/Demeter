-- Sandbox-only integration test. Every fixture change and domain event rolls back.
-- Requires the synthetic Demo · Camila Torres student prepared for birthday UAT.
begin;
do $$
declare s public.students%rowtype; initial_events bigint; first_count integer; retry_count integer; preview jsonb; original_version integer;
begin
  assert private.birthday_occurs_on('2000-02-29','2027-02-28');
  assert not private.birthday_occurs_on('2000-02-29','2028-02-28');
  assert private.birthday_occurs_on('2000-02-29','2028-02-29');
  assert private.birthday_occurs_on('1995-10-19','2026-10-19');
  assert not private.birthday_occurs_on('1995-10-19','2026-10-20');
  assert not private.birthday_occurs_on('2026-02-30','2026-02-28');
  assert not private.birthday_occurs_on('invalid','2026-10-19');
  assert not private.birthday_occurs_on(null,'2026-10-19');

  select * into strict s from public.students where full_name='Demo · Camila Torres' and user_id is null;
  update public.profile_field_values v set value='"1995-10-19"'::jsonb
  from public.profile_field_definitions d where v.definition_id=d.id and d.key='birth_date'
    and d.studio_id=s.studio_id and v.person_id=s.person_id;
  assert found, 'Birthday demo profile is missing';
  assert exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-19') c where c.student_id=s.id);
  assert not exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-20') c where c.student_id=s.id);
  assert not exists(select 1 from private.birthday_notification_candidates(gen_random_uuid(),'2026-10-19') c where c.student_id=s.id);

  update public.students set active=false where id=s.id;
  assert not exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-19') c where c.student_id=s.id);
  update public.students set active=true,lifecycle_status='inactive' where id=s.id;
  assert not exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-19') c where c.student_id=s.id);
  update public.students set lifecycle_status='active',student_type='trial',trial_status=null where id=s.id;
  assert not exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-19') c where c.student_id=s.id);
  update public.students set trial_status='converted' where id=s.id;
  assert exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-19') c where c.student_id=s.id);
  update public.students set student_type=s.student_type,trial_status=s.trial_status where id=s.id;
  update public.profile_field_values v set value='null'::jsonb
  from public.profile_field_definitions d where v.definition_id=d.id and d.key='birth_date'
    and d.studio_id=s.studio_id and v.person_id=s.person_id;
  assert not exists(select 1 from private.birthday_notification_candidates(s.studio_id,'2026-10-19') c where c.student_id=s.id);
  update public.profile_field_values v set value='"1995-10-19"'::jsonb
  from public.profile_field_definitions d where v.definition_id=d.id and d.key='birth_date'
    and d.studio_id=s.studio_id and v.person_id=s.person_id;

  select current_version_number into original_version from public.notification_rules where studio_id=s.studio_id and rule_key='marketing.birthday';
  perform private.seed_birthday_notification_rule(s.studio_id);
  assert (select current_version_number from public.notification_rules where studio_id=s.studio_id and rule_key='marketing.birthday')=original_version, 'Seeding must be idempotent';
  assert not exists(select 1 from public.notification_rule_channels c join public.notification_rules r on r.id=c.rule_id and r.current_version_number=c.version_number
    where r.studio_id=s.studio_id and r.rule_key='marketing.birthday' and c.channel_key<>'whatsapp'), 'Birthday must not change portal, push or email';
  select count(*) into initial_events from public.domain_events where studio_id=s.studio_id
    and event_type='student.birthday_due' and source_entity_id=s.id;
  update public.notification_rules set enabled=false where studio_id=s.studio_id and rule_key='marketing.birthday';
  assert private.notification_emit_birthdays_due_at('2026-10-20 05:59:59+00',s.studio_id)=0, 'Disabled rule emitted';
  update public.notification_rules set enabled=true where studio_id=s.studio_id and rule_key='marketing.birthday';
  first_count:=private.notification_emit_birthdays_due_at('2026-10-20 05:59:59+00',s.studio_id);
  retry_count:=private.notification_emit_birthdays_due_at('2026-10-20 05:59:59+00',s.studio_id);
  assert first_count>=1, 'First run must emit';
  assert retry_count=0, 'Retry must not duplicate';
  assert (select count(*) from public.domain_events where studio_id=s.studio_id
    and event_type='student.birthday_due' and source_entity_id=s.id)=initial_events+1;
  assert exists(select 1 from public.domain_events where studio_id=s.studio_id and event_type='student.birthday_due'
    and source_entity_id=s.id and payload=jsonb_build_object('student_id',s.id,'birthday_on','2026-10-19'));
  perform private.notification_emit_birthdays_due_at('2026-10-20 06:00:00+00',s.studio_id);
  assert (select count(*) from public.domain_events where studio_id=s.studio_id
    and event_type='student.birthday_due' and source_entity_id=s.id)=initial_events+1, 'Mexico midnight mismatch';
  perform private.notification_emit_birthdays_due_at('2027-10-20 05:00:00+00',s.studio_id);
  assert (select count(*) from public.domain_events where studio_id=s.studio_id
    and event_type='student.birthday_due' and source_entity_id=s.id)=initial_events+2, 'New year must be eligible';
  assert not public.system_birthday_notification_eligible(s.studio_id,s.id,(now() at time zone 'America/Mexico_City')::date-1), 'Yesterday must be rejected at delivery';

  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.admin_birthday_notification_preview(s.studio_id,'2026-10-19');
    raise exception 'Anonymous preview should be forbidden';
  exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',(select user_id::text from public.studio_memberships
    where studio_id=s.studio_id and role='owner' and active limit 1),true);
  preview:=public.admin_birthday_notification_preview(s.studio_id,'2026-10-19');
  assert (preview->>'total')::int>=1;
  assert preview::text not like '%1995%' and preview::text not like '%phone%' and preview::text not like '%birth_date%';
  begin
    perform public.admin_birthday_notification_preview(gen_random_uuid(),'2026-10-19');
    raise exception 'Cross-studio preview should be forbidden';
  exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
  assert not has_function_privilege('anon','public.admin_birthday_notification_preview(uuid,date)','execute');
  assert not has_function_privilege('authenticated','public.system_birthday_notification_eligible(uuid,uuid,date)','execute');
end $$;
rollback;
select 'passed: leap day, invalid/missing DOB, active/trial, tenant scope, disabled rule, annual dedupe, Mexico midnight, stale delivery, anonymous and staff access' as birthday_integration;
