grant select on public.notification_studio_channel_providers to authenticated;

drop policy if exists notification_studio_channel_providers_staff_read
on public.notification_studio_channel_providers;

create policy notification_studio_channel_providers_staff_read
on public.notification_studio_channel_providers
for select
to authenticated
using (private.has_capability(studio_id, 'integrations.read'));
