-- NEB-01-20 · lanzamientos por estudio (local DB only).
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

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
insert into public.studios (id, name, slug) values
  ('80000000-0000-0000-0000-000000000008', 'Estudio Beta', 'beta'),
  ('81000000-0000-0000-0000-000000000008', 'Estudio Normal', 'normal');
insert into public.studio_memberships values
  ('80000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000b1', 'owner', true);
insert into public.platform_features (key, name, description) values ('demo_feature', 'Demo', 'Algo nuevo');

-- 1 · Sin ambiente: se trata como producción y lo de Sandbox no aparece.
insert into results select 1, 'producción por defecto',
  not private.studio_feature_enabled('80000000-0000-0000-0000-000000000008', 'config_review')
  and private.platform_environment() = 'production';
-- 2 · En Sandbox sí aparece.
insert into public.platform_environment (name) values ('sandbox');
insert into results select 2, 'etapa Sandbox solo en Sandbox',
  private.studio_feature_enabled('80000000-0000-0000-0000-000000000008', 'config_review');
delete from public.platform_environment;

-- 3 · Beta: solo el estudio elegido; 4 · Todos exige confirmar.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_feature_stage('demo_feature', 'beta', false);
select public.platform_set_feature_beta_studio('demo_feature', '80000000-0000-0000-0000-000000000008', true);
reset role;
insert into results select 3, 'beta solo en el estudio elegido',
  private.studio_feature_enabled('80000000-0000-0000-0000-000000000008', 'demo_feature')
  and not private.studio_feature_enabled('81000000-0000-0000-0000-000000000008', 'demo_feature');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results select 4, 'pasar a todos pide confirmar',
  pg_temp.err($$select public.platform_set_feature_stage('demo_feature', 'all', false)$$) = 'feature_confirm_required';

-- 5 · Novedad para la dueña del estudio beta y se puede cerrar.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 5, 'novedad visible y se cierra',
  (public.studio_feature_news('80000000-0000-0000-0000-000000000008') -> 0 ->> 'key') = 'demo_feature'
  and (public.studio_feature_flags('80000000-0000-0000-0000-000000000008') ->> 'demo_feature') = 'true';
select public.studio_dismiss_feature_news('80000000-0000-0000-0000-000000000008', 'demo_feature');
insert into results select 6, 'cerrada ya no aparece',
  jsonb_array_length(public.studio_feature_news('80000000-0000-0000-0000-000000000008')) = 0;
insert into results select 7, 'dueña no maneja lanzamientos ni ve otro estudio',
  pg_temp.err($$select public.platform_features_list()$$) = 'forbidden'
  and pg_temp.err($$select public.platform_set_feature_stage('demo_feature', 'all', true)$$) = 'forbidden'
  and pg_temp.err($$select public.studio_feature_news('81000000-0000-0000-0000-000000000008')$$) = 'forbidden'
  and pg_temp.err($$select count(*) from public.platform_features$$) like 'permission denied%';

-- 8 · Todos con confirmación llega a todos y queda en bitácora.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.platform_set_feature_stage('demo_feature', 'all', true);
reset role;
insert into results select 8, 'todos con confirmación y bitácora',
  private.studio_feature_enabled('81000000-0000-0000-0000-000000000008', 'demo_feature')
  and (select count(*) from public.platform_audit_log where action = 'feature.stage.set' and detail->>'feature' = 'demo_feature') = 2
  and exists (select 1 from public.platform_audit_log where action = 'feature.beta.on');

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 8 then 'NEB01 RELEASES OK ' || count(*) else 'NEB01 RELEASES FAIL' end from results;
rollback;
