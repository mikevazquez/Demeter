-- Sandbox-only regression checks for workshop checkout.
-- Run against Sandbox with a privileged SQL session. Never run against production.
-- The fixture IDs are the synthetic UAT rows created for this branch.
-- All checks are read-only. Concurrency requires a separate multi-connection harness.
DO $uat$
DECLARE
  v_studio uuid := '9fe23cfa-fb47-4670-afeb-ed4a56433772';
  v_offer uuid := '556b0451-2d9c-4bc2-88fa-ec8315b86dc7';
  v_session uuid := '38f8b939-3d2f-42ca-a313-7c32de6b4726';
  v_purchase uuid := '52389716-de8c-4330-88d6-a5398ab60c05';
  v_sale uuid := '080f5a7c-8d3f-4abd-b77b-6be37a7f2569';
  v_count integer;
BEGIN
  IF (SELECT count(*) FROM public.workshop_purchases WHERE id = v_purchase AND studio_id = v_studio AND offer_id = v_offer AND total_minor = 60000 AND paid_minor = 30000 AND status = 'reserved') <> 1 THEN
    RAISE EXCEPTION 'UAT failed: original deposit purchase missing or inconsistent';
  END IF;
  IF (SELECT count(*) FROM public.sales WHERE id = v_sale AND studio_id = v_studio AND total_minor = 60000) <> 1 THEN
    RAISE EXCEPTION 'UAT failed: sale missing or inconsistent';
  END IF;
  IF (SELECT count(*) FROM public.payments WHERE sale_id = v_sale AND studio_id = v_studio AND kind = 'payment' AND amount_minor = 30000) <> 1 THEN
    RAISE EXCEPTION 'UAT failed: payment count or amount inconsistent';
  END IF;
  IF (SELECT count(*) FROM public.workshop_purchase_sessions wps JOIN public.reservations r ON r.id = wps.reservation_id WHERE wps.purchase_id = v_purchase AND wps.session_id = v_session AND r.status = 'reserved') <> 1 THEN
    RAISE EXCEPTION 'UAT failed: workshop reservation missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workshop_purchases WHERE idempotency_key = '22222222-2222-4222-8222-222222222222'::uuid AND studio_id = v_studio) THEN
    RAISE EXCEPTION 'UAT failed: rejected full-session checkout persisted';
  END IF;
  IF (SELECT count(*) FROM public.reservations WHERE session_id = v_session AND status IN ('reserved','attended')) > (SELECT capacity FROM public.class_sessions WHERE id = v_session) THEN
    RAISE EXCEPTION 'UAT failed: session oversold';
  END IF;
  SELECT count(*) INTO v_count FROM pg_catalog.pg_proc WHERE proname IN ('workshop_checkout_preflight', 'workshop_checkout_confirm') AND prosecdef = false AND NOT has_function_privilege('anon', oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND has_function_privilege('service_role', oid, 'EXECUTE');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'UAT failed: RPC permissions incorrect';
  END IF;
  RAISE NOTICE 'Workshop UAT fixture checks passed (read-only); concurrency and payment authorization remain unverified';
END
$uat$;
