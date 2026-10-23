-- NEB-01-36 · first-class price and enrollment credit (local DB only).
\set ON_ERROR_STOP on
begin;
create temp table results (n int, name text, ok boolean);
grant all on results to authenticated;
grant select on public.assistant_admin_rules to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics v_msg = message_text; return v_msg;
end $$;
grant execute on function pg_temp.err(text) to authenticated;
create function pg_temp.def(p_sig text) returns text language sql as $$ select pg_get_functiondef(p_sig::regprocedure) $$;

insert into public.studios (id, name, slug) values ('ab000000-0000-0000-0000-0000000000ab', 'Estudio Prueba', 'prueba');
insert into public.studio_memberships values ('ab000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-0000000000b1', 'owner', true);

-- 1 · defaults are Demeter's values ($150, $150, $150, same day).
insert into results select 1, 'valores de arranque',
  (p).trial_price_minor = 15000 and (p).enrollment_credit_minor = 15000
  and (p).enrollment_credit_min_enrollment_minor = 15000 and (p).enrollment_credit_valid_days = 0
  from (select private.trial_policy('ab000000-0000-0000-0000-0000000000ab') p) x;

-- 2 · no fixed 15000 left in the adjusted functions.
insert into results select 2, 'sin $150 fijo en las funciones',
  position('15000' in pg_temp.def('public.get_trial_enrollment_credit_options(uuid)')) = 0
  and position('15000' in pg_temp.def('public.create_package_with_trial_enrollment_credit(uuid,uuid,uuid,uuid,uuid,text,date,integer,text,date,text,text)')) = 0
  and position('15000' in pg_temp.def('public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid)')) = 0
  and position('15000' in pg_temp.def('public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid)')) = 0;

-- 3 · the options use the configured amount, never more than paid, and the valid days.
insert into results select 3, 'opciones con monto y plazo configurados',
  position('least((private.trial_policy(st.studio_id)).enrollment_credit_minor,sa.total_minor)' in pg_temp.def('public.get_trial_enrollment_credit_options(uuid)')) > 0
  and position('between today-(private.trial_policy(st.studio_id)).enrollment_credit_valid_days and today' in pg_temp.def('public.get_trial_enrollment_credit_options(uuid)')) > 0
  and position('''trial_credit_minor'',prior.amount_minor)' in pg_temp.def('public.create_package_with_trial_enrollment_credit(uuid,uuid,uuid,uuid,uuid,text,date,integer,text,date,text,text)')) > 0;

-- 4 · stored credits are no longer tied to $150.
insert into results select 4, 'abono guardado sin monto fijo',
  pg_temp.err($q$insert into public.trial_enrollment_credits (studio_id, amount_minor) values ('ab000000-0000-0000-0000-0000000000ab', 20000)$q$) = 'ok'
  and pg_temp.err($q$insert into public.trial_enrollment_credits (studio_id, amount_minor) values ('ab000000-0000-0000-0000-0000000000ab', 0)$q$) like '%violates check constraint%';

-- 5 · the owner saves price and credit; the Demi rule follows the switch.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.owner_update_studio_trial_credit('ab000000-0000-0000-0000-0000000000ab', 20000, true, 10000, 50000, 3);
reset role;
insert into results select 5, 'guardar primera clase y abono',
  (p).trial_price_minor = 20000 and (p).enrollment_credit_minor = 10000
  and (p).enrollment_credit_min_enrollment_minor = 50000 and (p).enrollment_credit_valid_days = 3
  and (select enabled from public.assistant_admin_rules where studio_id = 'ab000000-0000-0000-0000-0000000000ab' and rule_key = 'trial_payment_towards_enrollment')
  from (select private.trial_policy('ab000000-0000-0000-0000-0000000000ab') p) x;

-- 6 · switching it off keeps values and turns the rule off; invalid days rejected; coach forbidden.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.owner_update_studio_trial_credit('ab000000-0000-0000-0000-0000000000ab', 20000, false, 10000, 50000, 3);
insert into results select 6, 'apagar, validar y permisos',
  not (select enabled from public.assistant_admin_rules where studio_id = 'ab000000-0000-0000-0000-0000000000ab' and rule_key = 'trial_payment_towards_enrollment')
  and pg_temp.err($q$select public.owner_update_studio_trial_credit('ab000000-0000-0000-0000-0000000000ab', 20000, true, 10000, 50000, 31)$q$) like '%violates check constraint%';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
update results set ok = ok and pg_temp.err($q$select public.owner_update_studio_trial_credit('ab000000-0000-0000-0000-0000000000ab', 1, true, 1, 1, 0)$q$) = 'forbidden' where n = 6;
reset role;

select n, name, ok from results order by n;
select case when bool_and(coalesce(ok, false)) and count(*) = 6 then 'NEB01 TRIAL CREDIT OK ' || count(*) else 'NEB01 TRIAL CREDIT FAIL' end from results;
rollback;
