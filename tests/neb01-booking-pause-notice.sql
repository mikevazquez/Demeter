-- NEB-01-43 · aviso al pausar reservas (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);

insert into public.studios (id, name, slug) values ('b2000000-0000-0000-0000-00000000000b', 'Estudio Pausa', 'pausa');
insert into public.students (id, studio_id) values ('b3000000-0000-0000-0000-00000000000b', 'b2000000-0000-0000-0000-00000000000b');

insert into results select 1, 'regla instalada apagada con bandeja y push',
  exists (select 1 from public.notification_rules where studio_id = 'b2000000-0000-0000-0000-00000000000b'
    and rule_key = 'operations.booking_paused' and event_type = 'student.booking_paused' and not enabled)
  and (select array_agg(c.channel_key order by c.channel_key) from public.notification_rule_channels c
       join public.notification_rules r on r.id = c.rule_id
       where r.studio_id = 'b2000000-0000-0000-0000-00000000000b' and r.rule_key = 'operations.booking_paused') = array['inbox', 'push'];

insert into public.student_booking_penalties (studio_id, student_id, kind, events_count, window_days, ends_at)
values ('b2000000-0000-0000-0000-00000000000b', 'b3000000-0000-0000-0000-00000000000b', 'no_show', 2, 30, now() + interval '7 days');

insert into results select 2, 'evento con alumna, motivo y fecha',
  (select payload->>'student_id' = 'b3000000-0000-0000-0000-00000000000b' and payload->>'kind_label' = 'faltas'
     and payload->>'ends_on' ~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$'
   from public.domain_events where event_type = 'student.booking_paused');

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 2 then 'NEB01 PAUSE NOTICE OK ' || count(*) else 'NEB01 PAUSE NOTICE FAIL' end from results;
rollback;
