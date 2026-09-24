-- NOTIFICACIONES-02 · performance follow-up for the admin settings audit FK.
create index if not exists notification_admin_settings_updated_by_idx
on public.notification_admin_settings(updated_by_user_id);
