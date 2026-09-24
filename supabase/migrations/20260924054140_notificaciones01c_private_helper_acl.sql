-- NOTIFICACIONES-01C · Allow the internal delivery RPC to call its private recovery helper.

grant execute on function private.reconcile_stale_notification_delivery_attempts()
to service_role;
