-- Defense in depth for Demi Meta Inbox tables.
-- Existing Supabase projects may carry broad default grants even when RLS blocks writes.

revoke all on table public.assistant_channel_identities from authenticated;
revoke all on table public.assistant_meta_inbox_events from authenticated;
revoke all on table public.assistant_meta_inbox_deliveries from authenticated;

grant select on table public.assistant_channel_identities to authenticated;
grant select on table public.assistant_meta_inbox_events to authenticated;
grant select on table public.assistant_meta_inbox_deliveries to authenticated;

grant select,insert,update,delete on table public.assistant_channel_identities to service_role;
grant select,insert,update,delete on table public.assistant_meta_inbox_events to service_role;
grant select,insert,update,delete on table public.assistant_meta_inbox_deliveries to service_role;
