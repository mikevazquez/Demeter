-- PREPARED ONLY. Execute only after explicit production authorization and migrations.
-- Snapshot current configs/policy first. Keep Demi pilot-limited until native WhatsApp smoke passes.
begin;
select pg_advisory_xact_lock(hashtextextended('demi-production-activation-20261010',0));
do $activation$
declare
  studio constant uuid := 'f1d69ae2-84c5-4b76-b77c-d792c9318225';
  product constant uuid := '4fce6f68-cb8d-4f21-bc1c-9246d8a45a99';
  mapping jsonb;
begin
  if not exists(select 1 from public.studios where id=studio) then raise exception 'production_studio_missing'; end if;
  if not exists(select 1 from public.trial_booking_policies where studio_id=studio) then raise exception 'trial_policy_missing'; end if;
  -- New internal product: leave the historical $0 product and all old sales unchanged.
  insert into public.product_templates(id,studio_id,name,description,product_type,price_minor,currency,credit_limit,validity_days,unlimited,active,assistant_visible,online_purchasable,reward_discount_eligible,reward_credit_wallet)
  values(product,studio,'Primera clase · Demi 2.0','Producto interno de primera clase. Crédito: siete días desde la primera clase reservada.','other',15000,'MXN',1,7,false,true,false,false,false,false)
  on conflict(id) do nothing;
  if not exists(select 1 from public.product_templates where id=product and studio_id=studio and price_minor=15000 and currency='MXN' and active and not assistant_visible and not online_purchasable and credit_limit=1 and validity_days=7) then raise exception 'trial_product_conflict'; end if;
  update public.trial_booking_policies set require_payment_before_booking=true,trial_payment_product_template_id=product,updated_at=clock_timestamp() where studio_id=studio;
  update public.assistant_booking_behaviors set prospect_require_payment_before_booking=true where studio_id=studio;
  select jsonb_object_agg(k,jsonb_build_object('name','demeter_demi_seguimiento_v1','language','es_MX','bind_message_body',true)) into mapping
  from unnest(array['prospect_1','prospect_2','prospect_information_1','prospect_information_2','prospect_awaiting_receipt_1','prospect_awaiting_receipt_2','prospect_awaiting_participants_1','prospect_awaiting_participants_2','post_trial_1','post_trial_2','package_1','package_2','package_3','enrollment_1','enrollment_2','inactive_1','inactive_2','package_expiring_1','package_expiring_2','package_expired_1','package_expired_2']) k;
  -- Prepared mapping stays disabled during pilot. Enable only after Meta APPROVED
  -- and successful transport smoke, then restore the explicitly authorized Demi scope.
  insert into public.demi_followup_settings(studio_id,enabled,prospect_interval_hours,templates)
  values(studio,false,24,mapping)
  on conflict(studio_id) do update set enabled=false,prospect_interval_hours=24,templates=excluded.templates;
end;
$activation$;
commit;
