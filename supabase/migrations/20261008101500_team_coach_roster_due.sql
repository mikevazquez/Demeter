-- Coach roster reminder; default disabled until an approved Meta template exists.
-- Emits a single event per class session, not one event per booking.
do $$
declare s record;
begin
 for s in select id from public.studios loop
   perform private.ensure_default_notification_rule(
     s.id, 'team.coach_roster_reminder','team.coach_roster_due',
     'coach_roster_reminder','normal','session_instructor','{}'::jsonb,
     'before_session_start', '{"minutes_before":120,"late_policy":"send_now"}'::jsonb,
     null,'coach_roster_reminder',7200,
     '[{"channel_key":"inbox","is_required":true,"ordinal":0,"channel_policy":{}},{"channel_key":"whatsapp","is_required":false,"ordinal":1,"channel_policy":{"delivery_max_attempts":3}}]'::jsonb
   );
 end loop;
 update public.notification_rules set enabled=false
 where rule_key='team.coach_roster_reminder';
end $$;

-- The existing rule-version timing_config is the sole source of configured minutes.
-- Cron fires every five minutes; deduplication makes it safe on retries.
create or replace function private.notification_emit_coach_roster_due()
returns integer language plpgsql security definer set search_path='' as $$
declare rec record; emitted integer:=0;
begin
 for rec in
   select cs.id,cs.studio_id,cs.starts_at,
          coalesce((rv.timing_config->>'minutes_before')::integer,120) as minutes_before
   from public.class_sessions cs
   join public.notification_rules nr on nr.studio_id=cs.studio_id
     and nr.rule_key='team.coach_roster_reminder' and nr.enabled and nr.archived_at is null
   join public.notification_rule_versions rv on rv.rule_id=nr.id
     and rv.version_number=nr.current_version_number
   where cs.status='scheduled' and cs.instructor_id is not null
     and (cs.starts_at - make_interval(mins=>coalesce((rv.timing_config->>'minutes_before')::integer,120)))
        between clock_timestamp()-interval '10 minutes' and clock_timestamp()
     and cs.starts_at>clock_timestamp()
 loop
   if private.notification_try_emit_domain_event(
      rec.studio_id,'team.coach_roster_due','class_session',rec.id,
      'notification:team.coach_roster_due:'||rec.id::text,
      jsonb_build_object('session_id',rec.id,'starts_at',rec.starts_at),
      null,clock_timestamp()
   ) is not null then emitted:=emitted+1; end if;
 end loop;
 return emitted;
end $$;
revoke all on function private.notification_emit_coach_roster_due() from public,anon,authenticated;
-- Internal scheduled job; no user-facing access.
select cron.schedule('studio_flow_coach_roster_due','*/5 * * * *',
 'select private.notification_emit_coach_roster_due();');
