-- NOTIFICACIONES-02 · Production-safe default state
-- New notification control center launches with all processes and marketing automations paused.
-- Admin can selectively activate what is needed after deployment.

update public.notification_rules
set enabled = false,
    updated_at = clock_timestamp()
where archived_at is null;

update public.automation_instances
set status = 'paused',
    paused_at = coalesce(paused_at, clock_timestamp()),
    updated_at = clock_timestamp()
where status = 'active';

update public.notification_marketing_configs
set status = 'paused',
    updated_at = clock_timestamp()
where status = 'active';

create or replace function private.notification02_seed_new_studio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_notification02_operational_catalog(new.id);

  update public.notification_rules
  set enabled = false,
      updated_at = clock_timestamp()
  where studio_id = new.id
    and archived_at is null;

  insert into private.notification_operational_activation_baselines(
    studio_id,
    activated_at
  )
  values (new.id, clock_timestamp())
  on conflict (studio_id) do nothing;

  return new;
end;
$$;

revoke all on function private.notification02_seed_new_studio()
from public, anon, authenticated, service_role;
