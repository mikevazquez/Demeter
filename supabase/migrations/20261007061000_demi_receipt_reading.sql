alter table public.assistant_transfer_purchase_intents
  add column if not exists receipt_detected_amount_minor integer,
  add column if not exists receipt_detected_currency text,
  add column if not exists receipt_detected_date date,
  add column if not exists receipt_detected_reference text,
  add column if not exists receipt_detected_bank text,
  add column if not exists receipt_read_confidence numeric(5,4),
  add column if not exists receipt_amount_matches boolean,
  add column if not exists receipt_read_at timestamptz;
