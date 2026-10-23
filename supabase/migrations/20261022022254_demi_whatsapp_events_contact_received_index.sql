-- DEMI-BATCH-01/04: support newer-text lookup by tenant, contact and receipt time.
-- Apply in Studio Flow Sandbox first; production requires its own release approval.
create index if not exists assistant_whatsapp_events_contact_received_idx
  on public.assistant_whatsapp_events (studio_id, contact_wa_id, received_at);
