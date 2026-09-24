-- NOTIFICACIONES-01B · Notification Engine scheduler.
-- Invokes the internal worker once per minute using the existing Studio Flow dispatch token in Vault.

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'studio_flow_notification_engine'
  ) then
    perform cron.unschedule('studio_flow_notification_engine');
  end if;
end $$;

select cron.schedule(
  'studio_flow_notification_engine',
  '* * * * *',
  $cron$
    select net.http_post(
      url := rtrim(
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'studio_flow_project_url'
          limit 1
        ),
        '/'
      ) || '/functions/v1/notification-engine-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-studio-flow-dispatch-token',
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'studio_flow_automation_dispatch_token'
          limit 1
        )
      ),
      body := jsonb_build_object('limit', 50),
      timeout_milliseconds := 15000
    ) as request_id;
  $cron$
);
