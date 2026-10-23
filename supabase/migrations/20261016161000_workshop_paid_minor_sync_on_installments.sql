-- Keep the workshop purchase financial snapshot consistent with the source-of-truth payment ledger.
CREATE OR REPLACE FUNCTION public.sync_workshop_paid_from_sale_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_sale_id uuid;
BEGIN
  v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);
  UPDATE public.workshop_purchases wp
  SET paid_minor = LEAST(wp.total_minor, GREATEST(0, (
    SELECT COALESCE(SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_minor ELSE p.amount_minor END), 0)
    FROM public.payments p WHERE p.sale_id = v_sale_id
  )))::integer
  WHERE wp.sale_id = v_sale_id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS workshop_paid_from_sale_payment ON public.payments;
CREATE TRIGGER workshop_paid_from_sale_payment
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_workshop_paid_from_sale_payment();
