-- NOTIFICACIONES-01C · Cover tenant-aware and channel foreign keys.

create index notification_deliveries_channel_idx
  on public.notification_deliveries(channel_key);

create index notification_deliveries_tenant_event_idx
  on public.notification_deliveries(studio_id, source_event_id);

create index notification_deliveries_tenant_job_idx
  on public.notification_deliveries(studio_id, job_id);

create index notification_deliveries_tenant_notification_idx
  on public.notification_deliveries(studio_id, notification_id);

create index notification_deliveries_recipient_user_fk_idx
  on public.notification_deliveries(recipient_user_id)
  where recipient_user_id is not null;

create index notification_delivery_attempts_tenant_delivery_idx
  on public.notification_delivery_attempts(studio_id, delivery_id);
