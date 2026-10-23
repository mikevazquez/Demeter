-- NEB-01-15 · plantillas de arranque (local DB only).
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

-- Stand-ins for what the apply function writes.
do $$ begin create type public.product_type as enum ('package','membership','single_class','other','enrollment');
exception when duplicate_object then null; end $$;
create table if not exists public.disciplines (id uuid primary key default gen_random_uuid(), studio_id uuid not null, name text not null, active boolean not null default true, unique (studio_id, name));
alter table public.class_templates add column if not exists discipline_id uuid, add column if not exists duration_minutes integer,
  add column if not exists capacity integer, add column if not exists color_hex text, add column if not exists credit_cost integer;
alter table public.product_templates add column if not exists currency text, add column if not exists package_term text;
alter table public.product_templates drop constraint if exists product_templates_studio_name_uq;
alter table public.product_templates add constraint product_templates_studio_name_uq unique (studio_id, name);

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
insert into public.studios (id, name, slug) values ('90000000-0000-0000-0000-000000000009', 'Estudio Nuevo', 'nuevo');
insert into public.product_templates (studio_id, name, product_type, price_minor) values
  ('90000000-0000-0000-0000-000000000009', 'Yoga · 4 clases', 'package', 50000);

create temp table tpl as select '{
  "key": "yoga",
  "disciplines": ["Yoga"],
  "activities": [{"name":"Vinyasa","discipline":"Yoga","duration_minutes":60,"capacity":16,"color_hex":"#8FE6C8","credit_cost":1,"drop_in_price_minor":18000},
                 {"name":"Hatha","discipline":"Yoga","duration_minutes":60,"capacity":16,"color_hex":"malo","credit_cost":1,"drop_in_price_minor":18000}],
  "products": [{"name":"Yoga · 4 clases","product_type":"package","price_minor":62000,"credit_limit":4,"unlimited":false,"validity_days":30,"package_term":"monthly"},
               {"name":"Yoga · Ilimitado mensual","product_type":"membership","price_minor":180000,"credit_limit":null,"unlimited":true,"validity_days":30,"package_term":"monthly"},
               {"name":"Truco","product_type":"other","price_minor":1}]
}'::jsonb t;
grant select on tpl to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 1, 'solo plataforma aplica plantillas',
  pg_temp.err($$select public.platform_apply_starter_template('90000000-0000-0000-0000-000000000009', (select t from tpl))$$) = 'forbidden';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
create temp table r1 as select public.platform_apply_starter_template('90000000-0000-0000-0000-000000000009', (select t from tpl)) r;
create temp table r2 as select public.platform_apply_starter_template('90000000-0000-0000-0000-000000000009', (select t from tpl)) r;
insert into results select 2, 'plantilla inválida se rechaza',
  pg_temp.err($$select public.platform_apply_starter_template('90000000-0000-0000-0000-000000000009', '{"key":"x"}'::jsonb)$$) = 'template_invalid';
reset role;

insert into results select 3, 'crea lo que falta y respeta lo existente',
  (select r = '{"disciplines":1,"activities":2,"products":1}'::jsonb from r1)
  and (select price_minor from public.product_templates where name = 'Yoga · 4 clases') = 50000
  and not exists (select 1 from public.product_templates where name = 'Truco');
insert into results select 4, 'paquetes nuevos inactivos y color seguro',
  (select active from public.product_templates where name = 'Yoga · Ilimitado mensual') = false
  and (select color_hex from public.class_templates where name = 'Hatha') = '#FF0A8A'
  and (select d.name from public.class_templates c join public.disciplines d on d.id = c.discipline_id where c.name = 'Vinyasa') = 'Yoga';
insert into results select 5, 'aplicar dos veces no duplica y queda en bitácora',
  (select r = '{"disciplines":0,"activities":0,"products":0}'::jsonb from r2)
  and (select count(*) from public.platform_audit_log where action = 'studio.template.applied') = 2;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 5 then 'NEB01 STARTER TEMPLATES OK ' || count(*) else 'NEB01 STARTER TEMPLATES FAIL' end from results;
rollback;
