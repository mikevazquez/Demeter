-- Sandbox hedouonyhynuvwbckdlg ONLY. Synthetic and transactionally rolled back.
-- Does not validate trusted payment authorization, durable persistence, or UI.
DO $uat$
declare
 st uuid := '9fe23cfa-fb47-4670-afeb-ed4a56433772';
 student uuid := 'b2fb771e-206e-46cb-84dc-cc4c16722778';
 offer uuid := gen_random_uuid();
 ids uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 request_id uuid; selected uuid[]; mode text; expected int;
 i int; scenario int; q jsonb; receipt jsonb; snapshot jsonb;
 results jsonb := '[]'; err text;
begin
 if not exists(select 1 from public.workshop_offers where id='556b0451-2d9c-4bc2-88fa-ec8315b86dc7' and title='UAT TALL Synthetic Workshop' and studio_id=st) then raise exception 'synthetic_fixture_missing'; end if;
 begin
  insert into public.workshop_offers(id,studio_id,title,full_price_minor,allow_individual_sessions,requires_enrollment,overdue_mode,grace_minutes)
  values(offer,st,'UAT TALL-02 V2 rollback',60000,true,false,'keep_and_notify',60);
  for i in 1..3 loop
   insert into public.class_sessions(id,studio_id,template_id,starts_at,ends_at,capacity,assistant_visible)
   values(ids[i],st,'b503cb99-17e6-488a-9f82-594bef110a75',now()+make_interval(days=>70+i),now()+make_interval(days=>70+i,hours=>1),5,false);
   insert into public.workshop_offer_sessions values(offer,ids[i],15000);
  end loop;
  for scenario in 0..3 loop
   mode:=case when scenario=0 then 'full' else 'sessions' end;
   selected:=case when scenario=0 then ids else ids[1:scenario] end;
   expected:=case when scenario=0 then 60000 else 15000*scenario end;
   request_id:=gen_random_uuid();
   begin
    q:=public.workshop_checkout_preflight_v2(st,offer,student,selected,mode);
    if (q->>'total_minor')::int<>expected then raise exception 'quote_failed'; end if;
    receipt:=public.workshop_checkout_confirm_v2(st,offer,student,selected,mode,request_id,expected,'cash','SYNTHETIC-NO-REAL-PAYMENT');
    if not exists(select 1 from public.workshop_purchases w join public.sales s on s.id=w.sale_id join public.payments p on p.sale_id=s.id where w.id=(receipt->>'purchase_id')::uuid and w.total_minor=expected and s.total_minor=expected and p.amount_minor=expected and w.selection_mode=mode) then raise exception 'transaction_amounts_failed'; end if;
    if (select count(*) from public.workshop_purchase_sessions where purchase_id=(receipt->>'purchase_id')::uuid)<>cardinality(selected) then raise exception 'reservations_failed'; end if;
    if (public.workshop_checkout_confirm_v2(st,offer,student,selected,mode,request_id,expected,'cash','SYNTHETIC-NO-REAL-PAYMENT')->>'replayed')::boolean is not true then raise exception 'replay_failed'; end if;
    if (select count(*) from public.sales where id=(receipt->>'sale_id')::uuid)<>1 or (select count(*) from public.payments where sale_id=(receipt->>'sale_id')::uuid)<>1 then raise exception 'duplicates'; end if;
    select jsonb_build_object('mode',overdue_mode,'grace',grace_minutes) into snapshot from public.workshop_purchases where id=(receipt->>'purchase_id')::uuid;
    update public.workshop_offers set overdue_mode='release_after_grace',grace_minutes=1 where id=offer;
    if (select jsonb_build_object('mode',overdue_mode,'grace',grace_minutes) from public.workshop_purchases where id=(receipt->>'purchase_id')::uuid) is distinct from snapshot then raise exception 'historical_policy_changed'; end if;
    results:=results||jsonb_build_array(jsonb_build_object('mode',mode,'sessions',cardinality(selected),'quote_sale_payment_minor',expected,'idempotency',true,'policy_snapshot_unchanged',true));
    raise exception using errcode='P0002',message='scenario_rollback';
   exception when no_data_found then
    if sqlerrm<>'scenario_rollback' then raise; end if;
   end;
  end loop;
  begin
   perform public.workshop_checkout_preflight_v2(st,offer,student,ids[1:2],'full');
   raise exception 'accepted_partial_as_full';
  exception when others then
   if sqlerrm<>'full_selection_required' then raise; end if;
  end;
  update public.workshop_offers set allow_individual_sessions=false where id=offer;
  begin
   perform public.workshop_checkout_preflight_v2(st,offer,student,ids,'sessions');
   raise exception 'accepted_disabled_individuals';
  exception when others then
   if sqlerrm<>'individual_sessions_disabled' then raise; end if;
  end;
  update public.workshop_offers set allow_individual_sessions=true where id=offer;
  update public.workshop_offer_sessions set individual_price_minor=null where offer_id=offer and session_id=ids[1];
  begin
   perform public.workshop_checkout_preflight_v2(st,offer,student,ids,'sessions');
   raise exception 'accepted_missing_price';
  exception when others then
   if sqlerrm<>'individual_price_missing' then raise; end if;
  end;
  q:=public.workshop_checkout_preflight_v2(st,offer,student,ids,'full');
  if (q->>'total_minor')::int<>60000 then raise exception 'full_depends_on_individual'; end if;
  if exists(select 1 from pg_proc where proname in ('workshop_checkout_preflight_v2','workshop_checkout_confirm_v2') and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute') or prosecdef)) then raise exception 'unsafe_rpc_grants'; end if;
  raise exception using errcode='P0002',message='fixture_rollback';
 exception when no_data_found then
  if sqlerrm<>'fixture_rollback' then raise; end if;
 end;
 if exists(select 1 from public.workshop_offers where id=offer) or exists(select 1 from public.class_sessions where id=any(ids)) then raise exception 'rollback_failed'; end if;
 perform set_config('uat.workshop_v2_result',jsonb_build_object('scenarios',results,'negative_checks',3,'full_ignores_individual_prices',true,'rpc_permissions_checked',true,'fixtures_rolled_back',true,'ui_tested',false,'durably_persisted',false)::text,false);
end $uat$;
select current_setting('uat.workshop_v2_result')::jsonb as evidence;
