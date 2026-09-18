-- SF-160 · Advisor hardening.
-- Cover the composite tenant/event foreign key used by the idempotency ledger.

create index domain_event_consumptions_studio_event_idx
  on public.domain_event_consumptions(studio_id, event_id);
