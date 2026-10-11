create or replace function private.seed_portal_birthday_rule(p_studio_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_rule_id uuid; existed boolean;
begin
select exists(select 1 from public.notification_rules where studio_id=p_studio_id and rule_key='marketing.birthday') into existed;
v_rule_id:=private.ensure_default_notification_rule(p_studio_id,'marketing.birthday','student.birthday_due','birthday','normal','payload_student','{}','immediate','{}',null,'birthday',86400,'[{"channel_key":"inbox","is_required":true,"ordinal":0,"channel_policy":{}},{"channel_key":"push","is_required":false,"ordinal":1,"channel_policy":{}}]');
if not existed then
 update public.notification_rules set enabled=false where id=v_rule_id;
 update public.notification_rule_versions v set communication_class='P2' where v.rule_id=v_rule_id and studio_id=p_studio_id;
end if;
end $$;
create or replace function private.seed_portal_birthday_rule_trigger()
returns trigger language plpgsql security definer set search_path='' as $$ begin perform private.seed_portal_birthday_rule(new.id);return new;end $$;
create trigger studio_portal_birthday_rule after insert on public.studios for each row execute function private.seed_portal_birthday_rule_trigger();
do $$ declare studio record;begin for studio in select id from public.studios loop perform private.seed_portal_birthday_rule(studio.id);end loop;end $$;
create or replace function private.notification_emit_birthdays_due()
returns integer language plpgsql security definer set search_path='' as $$
declare rec record;emitted integer:=0;
begin
for rec in
 select s.id,s.studio_id,(now() at time zone st.timezone)::date as local_day
 from public.students s join public.studios st on st.id=s.studio_id
 join public.notification_rules r on r.studio_id=s.studio_id and r.rule_key='marketing.birthday' and r.enabled and r.archived_at is null
 where s.active and s.lifecycle_status='active'
 and exists(select 1 from public.profile_field_definitions d join public.profile_field_values v on v.definition_id=d.id and v.person_id=s.person_id
 where d.studio_id=s.studio_id and d.key='birth_date' and d.entity_type='student' and d.active
 and (v.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 and substring(v.value #>> '{}' from 6 for 5)=to_char(now() at time zone st.timezone,'MM-DD'))
loop
 if private.notification_try_emit_domain_event(rec.studio_id,'student.birthday_due','student',rec.id,
 'notification:student.birthday_due:'||rec.id::text||':'||rec.local_day::text,
 jsonb_build_object('student_id',rec.id,'birthday_on',rec.local_day),null,clock_timestamp()) is not null then emitted:=emitted+1;end if;
end loop;
return emitted;
end $$;
revoke all on function private.seed_portal_birthday_rule(uuid),private.seed_portal_birthday_rule_trigger(),private.notification_emit_birthdays_due() from public,anon,authenticated;
select cron.schedule('studio_flow_birthdays_due','*/15 * * * *','select private.notification_emit_birthdays_due();');

