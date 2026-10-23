-- NEB-01-35 · "hoy" en la zona de cada estudio (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);

insert into public.studios (id, name, slug, timezone) values
  ('60000000-0000-0000-0000-000000000006', 'Estudio Tijuana', 'tijuana', 'America/Tijuana'),
  ('70000000-0000-0000-0000-000000000007', 'Estudio Cancún', 'cancun', 'America/Cancun'),
  ('80000000-0000-0000-0000-000000000008', 'Sin zona', 'sin-zona', '');

-- 1 · each studio gets its own zone; empty falls back to central Mexico.
insert into results select 1, 'zona por estudio',
  private.studio_timezone('60000000-0000-0000-0000-000000000006') = 'America/Tijuana'
  and private.studio_timezone('80000000-0000-0000-0000-000000000008') = 'America/Mexico_City'
  and private.studio_timezone('99999999-0000-0000-0000-000000000009') = 'America/Mexico_City';

-- 2 · local today follows the studio zone.
insert into results select 2, 'hoy local',
  private.studio_local_today('60000000-0000-0000-0000-000000000006') = (now() at time zone 'America/Tijuana')::date
  and private.studio_local_today('70000000-0000-0000-0000-000000000007') = (now() at time zone 'America/Cancun')::date;

-- 3 · a payment without a date gets the studio local date.
insert into public.payments (studio_id, amount_minor) values ('60000000-0000-0000-0000-000000000006', 100);
insert into results select 3, 'pago con fecha local',
  (select effective_on from public.payments where studio_id = '60000000-0000-0000-0000-000000000006')
    = (now() at time zone 'America/Tijuana')::date;

-- 4 · an explicit date is kept.
insert into public.payments (studio_id, amount_minor, effective_on) values ('70000000-0000-0000-0000-000000000007', 100, date '2026-01-15');
insert into results select 4, 'fecha explícita se respeta',
  (select effective_on from public.payments where studio_id = '70000000-0000-0000-0000-000000000007') = date '2026-01-15';

-- 5 · the evening case: at 19:00 in CDMX (01:00 UTC next day) the local date is still today.
insert into results select 5, 'de noche sigue siendo hoy',
  ((timestamptz '2026-11-02 01:00:00+00') at time zone 'America/Mexico_City')::date = date '2026-11-01';

-- 6 · console helpers use the zone they get.
insert into results select 6, 'consola por zona',
  private.platform_month_start('America/Tijuana') = date_trunc('month', now() at time zone 'America/Tijuana') at time zone 'America/Tijuana'
  and private.platform_next_cut_on(5::smallint, 'America/Cancun') is not null;

-- 7 · no anon access to the helpers.
insert into results select 7, 'helpers privados',
  not has_function_privilege('anon', 'private.studio_local_today(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.neb_payment_local_effective_on()', 'execute');

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 7 then 'NEB01 TIMEZONE OK ' || count(*) else 'NEB01 TIMEZONE FAIL' end from results;
rollback;
