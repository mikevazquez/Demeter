-- Demi transfer receipt storage.
-- Private Storage bucket + receipt metadata on the student-scoped transfer intent.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'transfer-receipts',
  'transfer-receipts',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.assistant_transfer_purchase_intents
  add column if not exists receipt_storage_path text,
  add column if not exists receipt_mime_type text,
  add column if not exists receipt_file_size bigint,
  add column if not exists receipt_stored_at timestamptz;

alter table public.assistant_transfer_purchase_intents
  drop constraint if exists assistant_transfer_purchase_intents_receipt_mime_type_check;

alter table public.assistant_transfer_purchase_intents
  add constraint assistant_transfer_purchase_intents_receipt_mime_type_check
  check (
    receipt_mime_type is null
    or receipt_mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    )
  );
