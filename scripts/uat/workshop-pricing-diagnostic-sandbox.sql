-- Run only through the connector targeting hedouonyhynuvwbckdlg.
-- Synthetic rows and every side effect roll back in a subtransaction.
-- This is diagnostic evidence, NOT full UAT or durable persistence evidence.
DO $uat$
declare
  studio uuid := '9fe23cfa-fb47-4670-afeb-ed4a56433772';
  student uuid := 'b2fb771e-206e-46cb-84dc-cc4c16722778';
  offer uuid := gen_random_uuid();
  sessions uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  full_quote jsonb; partial_quote jsonb; receipt jsonb;
  result jsonb; n integer;
begin
  if not exists(select 1 from public.workshop_offers where id='556b0451-2d9c-4bc2-88fa-ec8315b86dc7' and title='UAT TALL Synthetic Workshop' and studio_id=studio) then
    raise exception 'synthetic_sandbox_fixture_missing';
  end if;
  begin
    insert into public.workshop_offers(id,studio_id,title,full_price_minor,allow_individual_sessions,requires_enrollment)
    values(offer,studio,'UAT TALL-02 rollback diagnostic',60000,true,false);
    for n in 1..3 loop
      insert into public.class_sessions(id,studio_id,template_id,starts_at,ends_at,capacity,assistant_visible)
      values(sessions[n],studio,'b503cb99-17e6-488a-9f82-594bef110a75',now()+make_interval(days=>60+n),now()+make_interval(days=>60+n,hours=>1),5,false);
      insert into public.workshop_offer_sessions values(offer,sessions[n],15000);
    end loop;
    full_quote := public.workshop_checkout_preflight(studio,offer,student,sessions);
    partial_quote := public.workshop_checkout_preflight(studio,offer,student,sessions[1:2]);
    if (full_quote->>'total_minor')::int<>60000 or (partial_quote->>'total_minor')::int<>30000 then raise exception 'pricing_assertion_failed'; end if;
    receipt := public.workshop_checkout_confirm(studio,offer,student,sessions[1:2],gen_random_uuid(),30000,'cash','SYNTHETIC-NO-REAL-PAYMENT');
    if not exists(select 1 from public.workshop_purchases w join public.sales s on s.id=w.sale_id join public.payments p on p.sale_id=s.id where w.id=(receipt->>'purchase_id')::uuid and w.total_minor=30000 and s.total_minor=30000 and p.amount_minor=30000) then raise exception 'transaction_amounts_failed'; end if;
    if (select count(*) from public.workshop_purchase_sessions where purchase_id=(receipt->>'purchase_id')::uuid)<>2 then raise exception 'reservation_count_failed'; end if;
    result := jsonb_build_object('full_quote',full_quote->'total_minor','two_individuals_quote',partial_quote->'total_minor','two_individuals_transaction_amount',30000,'linked_reservations',2,'all_individuals_expected',45000,'all_individuals_rpc_quote',full_quote->'total_minor','mode_missing_defect',true,'durably_persisted',false,'ui_tested',false);
    raise exception using errcode='P0002',message='uat_rollback';
  exception when no_data_found then
    if sqlerrm<>'uat_rollback' then raise; end if;
  end;
  if exists(select 1 from public.workshop_offers where id=offer) or exists(select 1 from public.class_sessions where id=any(sessions)) then raise exception 'rollback_failed'; end if;
  perform set_config('uat.workshop_pricing_result',result::text,false);
end $uat$;
select current_setting('uat.workshop_pricing_result')::jsonb as diagnostic;
