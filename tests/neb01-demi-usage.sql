-- NEB-01-21 · uso de Demi por estudio (local DB only).
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
insert into public.studios (id, name, slug) values ('a1000000-0000-0000-0000-00000000000a', 'Estudio Demi', 'demi');
insert into public.assistant_model_calls (studio_id, conversation_id, model, input_tokens, output_tokens, estimated_cost_usd_micros, status, created_at) values
  ('a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000c', 'm1', 1000, 200, 3000, 'completed', now()),
  ('a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000c', 'm1', 500, 100, 1500, 'error', now() - interval '1 day'),
  ('a1000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000c', 'm2', 100, 10, 200, 'completed', now()),
  ('a1000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000c', 'm1', 999, 999, 999999, 'completed', now() - interval '40 days');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
create temp table u as select public.platform_studio_demi_usage('a1000000-0000-0000-0000-00000000000a', 30) u;
insert into results select 1, 'totales de 30 días sin lo viejo',
  (select (u#>>'{totals,calls}')::int = 3 and (u#>>'{totals,errors}')::int = 1
     and (u#>>'{totals,cost_usd_micros}')::int = 4700 and (u#>>'{totals,conversations}')::int = 2 from u);
insert into results select 2, 'por día, modelo y conversación más cara',
  (select jsonb_array_length(u->'daily') = 2 and u#>>'{models,0,model}' = 'm1'
     and u#>>'{top_conversations,0,conversation_id}' = 'c1000000-0000-0000-0000-00000000000c' from u);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results select 3, 'solo plataforma',
  pg_temp.err($$select public.platform_studio_demi_usage('a1000000-0000-0000-0000-00000000000a', 30)$$) = 'forbidden';
reset role;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 3 then 'NEB01 DEMI USAGE OK ' || count(*) else 'NEB01 DEMI USAGE FAIL' end from results;
rollback;
