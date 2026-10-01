-- Studio Flow V2 release support for integration status reads.
-- Uses the stable settings.write capability instead of V2 module-entitlement capabilities.

grant select on public.notification_studio_channel_providers to authenticated;

drop policy if exists notification_studio_channel_providers_v2_release_staff_read
on public.notification_studio_channel_providers;

create policy notification_studio_channel_providers_v2_release_staff_read
on public.notification_studio_channel_providers
for select
to authenticated
using (private.has_capability(studio_id, 'settings.write'));
