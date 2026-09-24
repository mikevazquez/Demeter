-- NOTIFICACIONES-01C · Email adapter exists; provider configuration is still absent.
-- Keeping the adapter enabled lets delivery truth report email_provider_not_configured
-- instead of incorrectly reporting that the adapter itself is disabled.

update public.notification_channel_adapters
set
  enabled = true,
  updated_at = clock_timestamp()
where channel_key = 'email'
  and adapter_key = 'email_provider';
