-- ASISTIAN-INBOUND-06
-- Harden table grants: authenticated users only need read access through RLS.
-- All writes are performed by service_role or capability-checked admin RPCs.

revoke all on table public.asistian_webhook_events
from public, anon, authenticated;

grant select on table public.asistian_webhook_events
to authenticated;

grant select, insert, update on table public.asistian_webhook_events
to service_role;

revoke all on table public.asistian_booking_links
from public, anon, authenticated;

grant select on table public.asistian_booking_links
to authenticated;

grant select, insert, update on table public.asistian_booking_links
to service_role;

revoke all on table public.asistian_service_mappings
from public, anon, authenticated;

grant select on table public.asistian_service_mappings
to authenticated;

grant select, insert, update, delete on table public.asistian_service_mappings
to service_role;
