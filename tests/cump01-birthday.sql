-- CUMP-01 · pase de regalo de cumpleaños y WhatsApp del día 1 (base LOCAL únicamente).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
grant all on results to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg;
end $$;
grant execute on function pg_temp.err(text) to authenticated;
grant select on public.reservations, public.birthday_passes to authenticated;

-- Estudio Flor: dueño (b1), Camila cumple hoy (d1), Laura cumple otro mes (d2), Ana ya es alumna (d3).
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-0000000000d3');
insert into public.studios (id, name) values ('a0000000-0000-0000-0000-00000000000a', 'Estudio Flor');
insert into public.studio_memberships values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'student', true);
insert into public.persons (id, studio_id, first_name, last_name) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Camila', 'Torres'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Laura', 'Ruiz'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Ana', 'Gil');
insert into public.person_contacts (person_id, studio_id, kind, value) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'phone', '+525511111111'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'phone', '+525533333333');
insert into public.students (id, studio_id, person_id, user_id, full_name) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'Camila Torres'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d2', 'Laura Ruiz'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000d3', 'Ana Gil');
insert into public.profile_field_definitions (id, studio_id, entity_type, key) values
  ('d0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a', 'student', 'birth_date');
insert into public.profile_field_values (studio_id, person_id, definition_id, value) values
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d',
    to_jsonb(to_char(((now() at time zone 'America/Mexico_City')::date - interval '30 years')::date, 'YYYY-MM-DD'))),
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000d',
    to_jsonb(to_char(((now() at time zone 'America/Mexico_City')::date - interval '30 years' + interval '2 months')::date, 'YYYY-MM-DD')));
insert into public.class_templates (id, studio_id, name) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Pole Fitness');
insert into public.class_templates (id, studio_id, name, workshop_offer_id) values
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Taller', gen_random_uuid());
insert into public.class_sessions (id, studio_id, template_id, starts_at, capacity) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', now() + interval '1 hour', 10),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
    (date_trunc('month', now() at time zone 'America/Mexico_City') + interval '1 month 10 days 12 hours') at time zone 'America/Mexico_City', 10),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', now() + interval '1 hour', 10);

-- 1 · Camila ve su saludo y un pase disponible; nadie más lo ve.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
create temp table snap as select public.student_birthday_pass_snapshot() s;
reset role;
insert into results select 1, 'snapshot: cumpleaños y pase disponible',
  (select s->>'eligible' = 'true' and s->>'state' = 'available' and s->>'is_birthday' = 'true'
     and s->>'friend_enabled' = 'true' and not (s ? 'birth_date') from snap);

-- 2 · Laura (otro mes) no recibe pase.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
insert into results select 2, 'fuera de su mes no hay pase',
  (select public.student_birthday_pass_snapshot()->>'reason_code') = 'outside_birthday_month';
reset role;

-- 3 · Validaciones: talleres, fuera del mes, WhatsApp inválido, la amiga no puede ser ella misma.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 3, 'taller y mes siguiente rechazados',
  public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000003')->>'reason_code' = 'birthday_pass_not_for_workshops'
  and public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000002')->>'reason_code' = 'birthday_pass_outside_validity';
insert into results select 4, 'WhatsApp inválido y amiga = ella misma',
  public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'friend', 'Sofía', '12345')->>'reason_code' = 'friend_phone_invalid'
  and public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'friend', 'Yo', '55 1111 1111')->>'reason_code' = 'friend_is_self';

-- 5 · Para ella: reserva sin créditos; el segundo intento se rechaza.
create temp table r_self as select public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'self') r;
reset role;
insert into results select 5, 'reserva propia sin créditos ni paquete',
  (select r->>'ok' = 'true' from r_self)
  and exists(select 1 from public.reservations where id = (select (r->>'reservation_id')::uuid from r_self)
    and credits_held = 0 and acquisition_id is null and birthday_pass_id is not null)
  and (select status from public.birthday_passes where student_id = 'e0000000-0000-0000-0000-000000000001') = 'used';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 6, 'no se usa dos veces',
  public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'friend', 'Sofía Paz', '5522222222')->>'reason_code' = 'birthday_pass_already_used';
reset role;

-- 7 · Cancelación a tiempo: el pase regresa. 8 · tarde: se pierde.
update public.reservations set status = 'cancelled_on_time' where id = (select (r->>'reservation_id')::uuid from r_self);
insert into results select 7, 'cancelada a tiempo devuelve el pase',
  (select status = 'available' and used_session_id is null from public.birthday_passes where student_id = 'e0000000-0000-0000-0000-000000000001');

-- 9 · Para una amiga nueva (10 dígitos): invitada con +52, contacto en CRM y uso registrado.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
create temp table r_friend as select public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'friend', '  Sofía   Paz ', '55 2222 2222') r;
create temp table snap2 as select public.student_birthday_pass_snapshot() s;
reset role;
insert into results select 9, 'regalo a amiga nueva',
  (select r->>'ok' = 'true' from r_friend)
  and exists(select 1 from public.reservations r join public.persons p on p.id = r.guest_person_id
    join public.person_contacts pc on pc.person_id = p.id
    where r.id = (select (x.r->>'reservation_id')::uuid from r_friend x) and r.student_id is null
      and p.first_name = 'Sofía' and p.last_name = 'Paz' and pc.value = '+525522222222')
  and exists(select 1 from public.crm_contacts where source = 'birthday_pass')
  and (select s->>'state' = 'used' and s->>'recipient_kind' = 'friend' and s->>'recipient_name' = 'Sofía'
         and s->>'used_class_name' = 'Pole Fitness' from snap2);

update public.reservations set status = 'cancelled_late' where id = (select (r->>'reservation_id')::uuid from r_friend);
insert into results select 8, 'cancelación tardía no devuelve el pase',
  (select status from public.birthday_passes where student_id = 'e0000000-0000-0000-0000-000000000001') = 'used';

-- 10 · Equipo: estado en la ficha; una alumna no puede consultarlo.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 10, 'ficha: estado del pase para el equipo',
  (select x->>'in_birthday_month' = 'true' and x#>>'{pass,state}' = 'used' and x#>>'{pass,recipient_name}' = 'Sofía'
   from (select public.admin_student_birthday_pass('e0000000-0000-0000-0000-000000000001') x) q);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 11, 'alumna no lee la ficha',
  pg_temp.err($$select public.admin_student_birthday_pass('e0000000-0000-0000-0000-000000000001')$$) = 'forbidden';
reset role;

-- 12 · Regalo apagado: el saludo sigue, el pase no; también apaga el aviso del día 1.
update public.notification_rules set enabled = true where rule_key = 'marketing.birthday_month';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.admin_update_birthday_settings('a0000000-0000-0000-0000-00000000000a', false, true);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 12, 'regalo apagado: saludo sí, pase no',
  (select s->>'reason_code' = 'gift_disabled' and s->>'is_birthday' = 'true' from (select public.student_birthday_pass_snapshot() s) q)
  and public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001')->>'reason_code' = 'birthday_gift_disabled';
reset role;
insert into results select 13, 'apagar el regalo apaga el aviso del día 1',
  not (select enabled from public.notification_rules where rule_key = 'marketing.birthday_month');

-- 14 · Regalar a una amiga apagado; alumna no puede cambiar la configuración.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.admin_update_birthday_settings('a0000000-0000-0000-0000-00000000000a', true, false);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into results select 14, 'regalar a amiga apagado y configuración protegida',
  public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'friend', 'Sofía', '5522222222')->>'reason_code' = 'birthday_friend_disabled'
  and pg_temp.err($$select public.admin_update_birthday_settings('a0000000-0000-0000-0000-00000000000a', true, true)$$) = 'forbidden';
reset role;
update public.studio_birthday_settings set gift_friend_enabled = true;

-- 15 · Amiga que ya es alumna: la reserva queda a su nombre, sin créditos (se reinicia el pase a mano).
update public.reservations set status = 'cancelled_on_time' where id = (select (r->>'reservation_id')::uuid from r_friend);
update public.birthday_passes set status = 'available', recipient_kind = null, recipient_student_id = null,
  recipient_person_id = null, used_session_id = null, used_at = null;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
create temp table r_ana as select public.student_book_with_birthday_pass('b0000000-0000-0000-0000-000000000001', 'friend', 'Ana', '+52 55 3333 3333') r;
reset role;
insert into results select 15, 'amiga alumna reservada a su nombre',
  exists(select 1 from public.reservations where id = (select (r->>'reservation_id')::uuid from r_ana)
    and student_id = 'e0000000-0000-0000-0000-000000000003' and credits_held = 0 and guest_person_id is null);

-- 16 · El estudio cancela la clase: el pase regresa.
update public.reservations set status = 'cancelled_by_studio' where id = (select (r->>'reservation_id')::uuid from r_ana);
insert into results select 16, 'clase cancelada por el estudio devuelve el pase',
  (select status from public.birthday_passes where student_id = 'e0000000-0000-0000-0000-000000000001') = 'available';

-- 17 · Día 1: regla instalada apagada, solo WhatsApp; candidatas del mes; un aviso por año.
insert into results select 17, 'regla del día 1 instalada apagada y solo WhatsApp',
  exists(select 1 from public.notification_rules r join public.notification_rule_versions v on v.rule_id = r.id and v.version_number = r.current_version_number
    where r.rule_key = 'marketing.birthday_month' and r.event_type = 'student.birthday_month_due' and v.template_key = 'birthday_month'
      and v.revalidation_strategy_key = 'birthday_month_start')
  and (select array_agg(c.channel_key) from public.notification_rule_channels c join public.notification_rules r on r.id = c.rule_id
       where r.rule_key = 'marketing.birthday_month') = array['whatsapp'];
update public.notification_rules set enabled = true where rule_key = 'marketing.birthday_month';
insert into results select 18, 'candidatas del día 1 = alumnas de ese mes',
  (select array_agg(student_id) from private.birthday_month_notification_candidates('a0000000-0000-0000-0000-00000000000a',
     date_trunc('month', now() at time zone 'America/Mexico_City')::date)) = array['e0000000-0000-0000-0000-000000000001'::uuid]
  and not exists(select 1 from private.birthday_month_notification_candidates('a0000000-0000-0000-0000-00000000000a',
     date_trunc('month', now() at time zone 'America/Mexico_City')::date + 1));
insert into results select 19, 'un aviso por alumna y año',
  private.notification_emit_birthday_months_due_at(
    (date_trunc('month', now() at time zone 'America/Mexico_City') + interval '9 hours') at time zone 'America/Mexico_City') = 1
  and private.notification_emit_birthday_months_due_at(
    (date_trunc('month', now() at time zone 'America/Mexico_City') + interval '10 hours') at time zone 'America/Mexico_City') = 0
  and private.notification_emit_birthday_months_due_at(now() + interval '0 seconds', null) >= 0
  and (select payload->>'month_start' from public.domain_events where event_type = 'student.birthday_month_due')
      = to_char(date_trunc('month', now() at time zone 'America/Mexico_City'), 'YYYY-MM-DD');
update public.studio_birthday_settings set gift_enabled = false;
insert into results select 20, 'sin regalo no hay candidatas del día 1',
  not exists(select 1 from private.birthday_month_notification_candidates('a0000000-0000-0000-0000-00000000000a',
     date_trunc('month', now() at time zone 'America/Mexico_City')::date));
update public.studio_birthday_settings set gift_enabled = true;

-- 21 · Vista previa del día 1 para el dueño; 22 · la plantilla birthday_month se puede asignar.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 21, 'vista previa del día 1',
  (public.admin_birthday_month_notification_preview('a0000000-0000-0000-0000-00000000000a', (now() at time zone 'America/Mexico_City')::date)->>'total')::int = 1;
reset role;
insert into results select 22, 'clave birthday_month permitida en plantillas',
  position('''birthday_month''' in pg_get_functiondef('public.admin_update_meta_whatsapp_templates(uuid,text,text,jsonb)'::regprocedure)) > 0;

select case when bool_and(ok) then 'cump01 birthday: ' || count(*) || '/' || count(*) || ' OK'
  else 'cump01 birthday FALLÓ: ' || string_agg(n || ' ' || name, '; ' order by n) filter (where not ok) end
from results;
rollback;
