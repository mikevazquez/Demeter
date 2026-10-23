-- NEB-01-10/11/12 · console reads for the platform (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
grant all on results to authenticated;

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text;
  return v_msg;
end $$;
grant execute on function pg_temp.err(text) to authenticated;

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.studios (id, name, slug, brand_name) values
  ('40000000-0000-0000-0000-000000000004', 'Estudio Aurora Pilates', 'aurora', 'Aurora');
update auth.users set last_sign_in_at = now() - interval '2 hours' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.studio_memberships values
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c1', 'coach', true);

-- Synthetic data for Aurora: 3 students (1 inactive), 2 with an active package, classes,
-- reservations, sales and Demi usage this month, plus old rows that must not count.
insert into public.students (studio_id, active, created_at) values
  ('40000000-0000-0000-0000-000000000004', true, now()),
  ('40000000-0000-0000-0000-000000000004', true, now() - interval '90 days'),
  ('40000000-0000-0000-0000-000000000004', false, now() - interval '90 days'),
  ('10000000-0000-0000-0000-000000000001', true, now());
insert into public.product_acquisitions (studio_id, student_id, status, expires_on) values
  ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', 'active', current_date + 10),
  ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002', 'active', null),
  ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 'active', current_date - 1),
  ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 'expired', current_date + 5);
insert into public.class_sessions (studio_id, starts_at, status) values
  ('40000000-0000-0000-0000-000000000004', private.platform_week_start() + interval '1 hour', 'scheduled'),
  ('40000000-0000-0000-0000-000000000004', private.platform_week_start() + interval '2 hours', 'cancelled'),
  ('40000000-0000-0000-0000-000000000004', private.platform_week_start() - interval '40 days', 'completed');
insert into public.reservations (studio_id, status, booked_at) values
  ('40000000-0000-0000-0000-000000000004', 'reserved', now()),
  ('40000000-0000-0000-0000-000000000004', 'attended', now()),
  ('40000000-0000-0000-0000-000000000004', 'cancelled_late', now()),
  ('40000000-0000-0000-0000-000000000004', 'attended', now() - interval '60 days');
insert into public.sales (studio_id, status, total_minor, created_at) values
  ('40000000-0000-0000-0000-000000000004', 'confirmed', 120000, now()),
  ('40000000-0000-0000-0000-000000000004', 'voided', 50000, now()),
  ('40000000-0000-0000-0000-000000000004', 'confirmed', 99900, now() - interval '60 days');
insert into public.assistant_model_calls (studio_id, input_tokens, output_tokens, estimated_cost_usd_micros, created_at) values
  ('40000000-0000-0000-0000-000000000004', 1000, 200, 3000, now()),
  ('40000000-0000-0000-0000-000000000004', 500, 100, 1500, now()),
  ('40000000-0000-0000-0000-000000000004', 9999, 9999, 99999, now() - interval '60 days');

-- Owner of Aurora asks for catalog; Mike sets it to Core, cut day 5.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_studio_plan('40000000-0000-0000-0000-000000000004', 'core', 5::smallint);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.studio_request_module('40000000-0000-0000-0000-000000000004', 'catalogo');
select public.studio_request_module('40000000-0000-0000-0000-000000000004', 'recursos');

-- 1-3 · only the platform reads the console; an owner or coach gets 'forbidden'.
insert into results select 1, 'dueño no ve la consola',
  pg_temp.err('select public.platform_overview()') = 'forbidden'
  and pg_temp.err('select public.platform_list_studios()') = 'forbidden';
insert into results select 2, 'dueño no ve la ficha de otro ni la suya',
  pg_temp.err($q$select public.platform_studio_detail('40000000-0000-0000-0000-000000000004')$q$) = 'forbidden';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into results select 3, 'coach no ve la consola',
  pg_temp.err('select public.platform_overview()') = 'forbidden';

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
create temp table o as select public.platform_overview() as j;
create temp table d as select public.platform_studio_detail('40000000-0000-0000-0000-000000000004') as j;
create temp table l as select public.platform_list_studios() as j;

-- 4 · overview: Core 899 counts toward MRR, Demeter (internal) does not; 2 pending requests.
insert into results select 4, 'inicio: MRR, estudios y solicitudes',
  (j ->> 'studios_total')::int = 2 and (j ->> 'mrr_mxn')::int = 899
  and (j -> 'studios_by_status' ->> 'internal')::int = 1 and (j -> 'studios_by_status' ->> 'active')::int = 1
  and (j ->> 'founding_seats')::int = 5 and (j ->> 'founding_used')::int = 0
  and (j ->> 'students_active')::int = 3 and (j ->> 'pending_requests')::int = 2
  from o;

-- 5 · list: Aurora with brand, plan, price, cut day, students and requests.
insert into results select 5, 'lista de estudios',
  jsonb_array_length(j) = 2
  and exists (select 1 from jsonb_array_elements(j) e where e ->> 'slug' = 'aurora'
    and e ->> 'brand_name' = 'Aurora' and e ->> 'plan' = 'core' and (e ->> 'monthly_price_mxn')::int = 899
    and (e ->> 'cut_day')::int = 5 and e ->> 'next_cut_on' is not null
    and (e ->> 'students_active')::int = 2 and (e ->> 'pending_requests')::int = 2)
  from l;

-- 6 · numbers: students, packages, classes, reservations, sales and Demi only for this month.
insert into results select 6, 'ficha: números del mes',
  (j -> 'students' ->> 'total')::int = 3 and (j -> 'students' ->> 'active')::int = 2
  and (j -> 'students' ->> 'new_this_month')::int = 1
  and (j ->> 'students_with_package')::int = 2
  and (j -> 'classes' ->> 'this_week')::int = 1
  and (j -> 'reservations_month' ->> 'booked')::int = 2
  and (j -> 'reservations_month' ->> 'attended')::int = 1
  and (j -> 'reservations_month' ->> 'cancelled')::int = 1
  and (j -> 'sales_month' ->> 'count')::int = 1 and (j -> 'sales_month' ->> 'total_minor')::bigint = 120000
  and (j -> 'demi_month' ->> 'calls')::int = 2 and (j -> 'demi_month' ->> 'input_tokens')::int = 1500
  and (j -> 'demi_month' ->> 'output_tokens')::int = 300 and (j -> 'demi_month' ->> 'cost_usd_micros')::int = 4500
  from d;

-- 7 · plan, cut day, next renewal and owner's last sign-in.
insert into results select 7, 'ficha: plan, corte y último acceso',
  j -> 'entitlements' ->> 'plan' = 'core' and (j -> 'entitlements' ->> 'monthly_price_mxn')::int = 899
  and (j ->> 'next_cut_on')::date >= current_date - 1 and extract(day from (j ->> 'next_cut_on')::date) = 5
  and (j ->> 'owner_last_sign_in_at')::timestamptz < now() - interval '1 hour'
  from d;

-- 8 · pending requests and audit trail in the detail.
insert into results select 8, 'ficha: solicitudes y bitácora',
  jsonb_array_length(j -> 'pending_requests') = 2
  and exists (select 1 from jsonb_array_elements(j -> 'audit') a where a ->> 'action' = 'studio.plan.set')
  and exists (select 1 from jsonb_array_elements(j -> 'audit') a where a ->> 'action' = 'studio.module.requested')
  from d;

-- 9 · activating a requested module removes it from pending; it shows up in entitlements.
select public.platform_set_studio_module('40000000-0000-0000-0000-000000000004', 'catalogo', true);
insert into results select 9, 'activar módulo pedido lo quita de pendientes',
  jsonb_array_length(j -> 'pending_requests') = 1 and (j -> 'entitlements' -> 'modules' ->> 'catalogo')::boolean
  and (j -> 'entitlements' ->> 'monthly_price_mxn')::int = 1198
  from (select public.platform_studio_detail('40000000-0000-0000-0000-000000000004') as j) x;

-- 10 · unknown studio and anon access.
insert into results select 10, 'estudio inexistente',
  pg_temp.err($q$select public.platform_studio_detail('99999999-0000-0000-0000-000000000009')$q$) = 'studio_not_found';
reset role;
insert into results select 11, 'anon no ejecuta lecturas',
  not has_function_privilege('anon', 'public.platform_overview()', 'execute')
  and not has_function_privilege('anon', 'public.platform_list_studios()', 'execute')
  and not has_function_privilege('anon', 'public.platform_studio_detail(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.platform_pending_requests(uuid)', 'execute');

-- 12 · next cut date math: always within the next month, on the given day.
insert into results select 12, 'cálculo de siguiente corte',
  private.platform_next_cut_on(null) is null
  and bool_and(private.platform_next_cut_on(d::smallint) between current_date - 1 and current_date + 32
    and extract(day from private.platform_next_cut_on(d::smallint)) = d)
  from generate_series(1, 28) d;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 12 then 'NEB01 CONSOLE OK ' || count(*) else 'NEB01 CONSOLE FAIL' end from results;
rollback;
