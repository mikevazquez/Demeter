-- Sandbox: guard against duplicate manual workshop installments from the existing Agenda card.
-- Scope matches the payment note written only by registerWorkshopAbono.
CREATE UNIQUE INDEX IF NOT EXISTS workshop_agenda_abono_reference_unique
  ON public.payments (studio_id, sale_id, reference)
  WHERE kind = 'payment'
    AND notes = 'Abono de taller desde Agenda'
    AND reference IS NOT NULL;
