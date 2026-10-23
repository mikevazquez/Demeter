-- Birthday greetings use the existing notification engine. New rules stay disabled.
create or replace function private.birthday_occurs_on(p_value text, p_day date)
returns boolean language plpgsql immutable set search_path = '' as $$
declare born date; anniversary date; y integer := extract(year from p_day)::integer;
begin
  if p_value is null or p_day is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  begin born := p_value::date;
  exception when invalid_datetime_format or datetime_field_overflow then return false; end;
  if extract(month from born)=2 and extract(day from born)=29
     and extract(day from (make_date(y,3,1)-1))=28 then
    anniversary := make_date(y,2,28);
  else anniversary := make_date(y,extract(month from born)::integer,extract(day from born)::integer); end if;
  return anniversary=p_day;
end $$;
revoke all on function private.birthday_occurs_on(text,date) from public,anon,authenticated,service_role;

create or replace function private.birthday_notification_candidates(p_studio_id uuid,p_day date)
returns table(student_id uuid,full_name text)
language sql stable set search_path = '' as $$
  select s.id,s.full_name from public.students s
  join public.studios st on st.id=s.studio_id and st.status='active'
  where s.studio_id=p_studio_id and s.active and s.lifecycle_status='active'
    and (s.student_type='regular' or (s.student_type='trial' and s.trial_status='converted'))
    and exists (
      select 1 from public.profile_field_definitions d
      join public.profile_field_values v on v.definition_id=d.id and v.studio_id=d.studio_id
        and v.person_id=s.person_id
      where d.studio_id=s.studio_id and d.entity_type='student' and d.key='birth_date' and d.active
        and private.birthday_occurs_on(v.value #>> '{}',p_day)
    )
    and (
      exists(select 1 from public.student_enrollments e where e.student_id=s.id and e.studio_id=s.studio_id
        and e.refunded_at is null and e.status='active' and e.starts_on<=p_day and (e.expires_on is null or e.expires_on>=p_day))
      or not exists(select 1 from public.student_enrollments e where e.student_id=s.id and e.studio_id=s.studio_id
        and e.refunded_at is null and (e.status='expired' or (e.status='active' and e.expires_on<p_day)))
    );
$$;
revoke all on function private.birthday_notification_candidates(uuid,date) from public,anon,authenticated,service_role;

create or replace function public.admin_birthday_notification_preview(p_studio_id uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id,'automations.read')
    or not exists(select 1 from public.studio_memberships m where m.user_id=auth.uid()
      and m.studio_id=p_studio_id and m.active and m.role in ('owner','admin','reception')) then
    raise exception 'forbidden';
  end if;
  if p_day is null then raise exception 'birthday_date_required'; end if;
  select jsonb_build_object('date',p_day,'total',count(*),'students',coalesce(jsonb_agg(
    jsonb_build_object('id',c.student_id,'name',c.full_name) order by c.full_name),'[]'::jsonb)) into result
  from private.birthday_notification_candidates(p_studio_id,p_day) c;
  return result;
end $$;
revoke all on function public.admin_birthday_notification_preview(uuid,date) from public,anon;
grant execute on function public.admin_birthday_notification_preview(uuid,date) to authenticated;

create or replace function public.system_birthday_notification_eligible(p_studio_id uuid,p_student_id uuid,p_birthday_on date)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_birthday_on=(now() at time zone 'America/Mexico_City')::date
    and exists(select 1 from private.birthday_notification_candidates(p_studio_id,p_birthday_on) c where c.student_id=p_student_id);
$$;
revoke all on function public.system_birthday_notification_eligible(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.system_birthday_notification_eligible(uuid,uuid,date) to service_role;

create or replace function private.seed_birthday_notification_rule(p_studio_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.notification_rules%rowtype; old_version public.notification_rule_versions%rowtype; next_version integer;
begin
  insert into public.notification_rules(studio_id,rule_key,event_type,enabled,current_version_number)
  values(p_studio_id,'marketing.birthday','student.birthday_due',false,1)
  on conflict(studio_id,rule_key) do nothing;
  select * into r from public.notification_rules where studio_id=p_studio_id and rule_key='marketing.birthday' for update;
  if r.archived_at is not null then return; end if;
  if r.event_type<>'student.birthday_due' then raise exception 'birthday_rule_conflict'; end if;
  select * into old_version from public.notification_rule_versions where rule_id=r.id and version_number=r.current_version_number;
  if found and old_version.template_key='birthday' and old_version.revalidation_strategy_key='birthday_today'
    and exists(select 1 from public.notification_rule_channels c where c.rule_id=r.id and c.version_number=r.current_version_number and c.channel_key='whatsapp')
    and not exists(select 1 from public.notification_rule_channels c where c.rule_id=r.id and c.version_number=r.current_version_number and c.channel_key<>'whatsapp') then return; end if;
  next_version := case when old_version.rule_id is null then r.current_version_number else r.current_version_number+1 end;
  insert into public.notification_rule_versions(studio_id,rule_id,version_number,notification_type,communication_class,
    priority,recipient_strategy_key,conditions,timing_strategy_key,timing_config,revalidation_strategy_key,
    template_key,expires_after_seconds,activated_at)
  values(p_studio_id,r.id,next_version,'birthday','P2','low','payload_student',coalesce(old_version.conditions,'{}'::jsonb),
    'immediate','{}'::jsonb,'birthday_today','birthday',86400,clock_timestamp());
  -- This greeting is WhatsApp-only: no student inbox, push, or email side effects.
  insert into public.notification_rule_channels(studio_id,rule_id,version_number,channel_key,is_required,ordinal,channel_policy)
  values(p_studio_id,r.id,next_version,'whatsapp',true,2,'{"provider_key":"meta_whatsapp","delivery_max_attempts":3}'::jsonb);
  update public.notification_rules set current_version_number=next_version,enabled=false,updated_at=now() where id=r.id;
end $$;
revoke all on function private.seed_birthday_notification_rule(uuid) from public,anon,authenticated,service_role;

create or replace function private.seed_birthday_notification_rule_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.seed_birthday_notification_rule(new.id); return new; end $$;
revoke all on function private.seed_birthday_notification_rule_trigger() from public,anon,authenticated,service_role;
drop trigger if exists zzz_studios_seed_birthday_notification on public.studios;
create trigger zzz_studios_seed_birthday_notification after insert on public.studios
for each row execute function private.seed_birthday_notification_rule_trigger();
do $$ declare s record; begin for s in select id from public.studios loop perform private.seed_birthday_notification_rule(s.id); end loop; end $$;

create or replace function private.notification_emit_birthdays_due_at(p_at timestamptz,p_studio_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare candidate record; emitted integer:=0; local_day date:=(p_at at time zone 'America/Mexico_City')::date;
begin
  if p_at is null then raise exception 'birthday_time_required'; end if;
  for candidate in
    select st.id as studio_id,c.student_id from public.studios st
    join public.notification_rules r on r.studio_id=st.id and r.rule_key='marketing.birthday' and r.enabled and r.archived_at is null
    cross join lateral private.birthday_notification_candidates(st.id,local_day) c
    where (p_studio_id is null or st.id=p_studio_id)
      and not exists(select 1 from public.domain_events e where e.studio_id=st.id
        and e.event_type='student.birthday_due' and e.source_entity_id=c.student_id
        and coalesce(e.payload->>'birthday_on',to_char(e.occurred_at at time zone 'America/Mexico_City','YYYY-MM-DD'))
          like extract(year from local_day)::text||'-%')
  loop
    if private.notification_try_emit_domain_event(candidate.studio_id,'student.birthday_due','student',candidate.student_id,
      'notification:student.birthday_due:'||candidate.studio_id::text||':'||candidate.student_id::text||':'||extract(year from local_day)::text,
      jsonb_build_object('student_id',candidate.student_id,'birthday_on',local_day),null,p_at) is not null then emitted:=emitted+1; end if;
  end loop;
  return emitted;
end $$;
revoke all on function private.notification_emit_birthdays_due_at(timestamptz,uuid) from public,anon,authenticated,service_role;

create or replace function private.notification_emit_birthdays_due()
returns integer language sql security definer set search_path = '' as $$
  select private.notification_emit_birthdays_due_at(clock_timestamp());
$$;
revoke all on function private.notification_emit_birthdays_due() from public,anon,authenticated,service_role;
select cron.schedule('studio_flow_birthdays_due','*/15 * * * *','select private.notification_emit_birthdays_due();');

-- Extend the existing template mapping allowlist; keep its authorization and credential handling.
CREATE OR REPLACE FUNCTION public.admin_update_meta_whatsapp_templates(target_studio_id uuid, target_language_code text, target_country_calling_code text, target_templates jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_language_code text := trim(coalesce(target_language_code, ''));
  v_country_calling_code text := trim(coalesce(target_country_calling_code, ''));
  v_templates jsonb := coalesce(target_templates, '{}'::jsonb);
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_payload jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;
  if v_language_code !~ '^[a-z]{2}_[A-Z]{2}$' then raise exception 'meta_language_code_invalid'; end if;
  if v_country_calling_code !~ '^[1-9][0-9]{0,2}$' then raise exception 'meta_country_calling_code_invalid'; end if;
  if jsonb_typeof(v_templates) <> 'object' then raise exception 'meta_templates_invalid'; end if;
  if exists (
    select 1 from jsonb_each_text(v_templates) as template_entry
    where template_entry.key not in (
      'birthday','student_welcome','reservation_confirmed','reservation_cancelled','waitlist_promoted',
      'class_reminder','coach_roster_reminder','class_cancelled_coach','class_cancelled_student','class_rescheduled',
      'evaluation_reminder','package_activated','package_expired','package_expiring',
      'session_cancelled_by_studio','challenge_invitation','workshop_event','referral_invitation',
      'package_recovery_1','package_recovery_2','attendance_no_show','credit_restored',
      'document_new_version','documents_pending','evaluation_completed','evaluation_invitation',
      'evaluation_scheduled','guardian_signature_pending','password_reset','payment_confirmed',
      'payment_pending','session_coach_changed','studio_closure','waitlist_expired'
    )
    or trim(template_entry.value) !~ '^[a-z0-9_]+$'
  ) then raise exception 'meta_templates_invalid'; end if;
  select s.id, s.decrypted_secret::jsonb into v_secret_id, v_payload
  from vault.decrypted_secrets s where s.name = v_secret_name limit 1;
  if v_secret_id is null or v_payload is null then raise exception 'meta_whatsapp_not_configured'; end if;
  v_payload := jsonb_set(v_payload, '{language_code}', to_jsonb(v_language_code), true);
  v_payload := jsonb_set(v_payload, '{country_calling_code}', to_jsonb(v_country_calling_code), true);
  v_payload := jsonb_set(v_payload, '{templates}', v_templates, true);
  perform vault.update_secret(v_secret_id, v_payload::text, v_secret_name,
    'Studio Flow direct Meta WhatsApp Cloud API connection');
  return true;
end;
$function$
;
