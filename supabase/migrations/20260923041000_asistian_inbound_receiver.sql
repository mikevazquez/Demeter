-- ASISTIAN -> STUDIO FLOW · receptor firmado para eventos salientes.
-- Primera fase: captura segura e idempotente del payload real para cerrar el mapeo de reservas.

create table if not exists public.asistian_webhook_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider_event_id text not null,
  event_name text not null,
  provider_timestamp text,
  attempt integer,
  payload jsonb not null,
  processing_status text not null default 'captured',
  processing_result jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint asistian_webhook_events_provider_event_required
    check (length(trim(provider_event_id)) > 0),
  constraint asistian_webhook_events_event_name_required
    check (length(trim(event_name)) > 0),
  constraint asistian_webhook_events_attempt_valid
    check (attempt is null or attempt >= 1),
  constraint asistian_webhook_events_status_valid
    check (processing_status in ('captured','processed','ignored','error')),
  constraint asistian_webhook_events_studio_event_unique
    unique (studio_id, provider_event_id)
);

create index if not exists asistian_webhook_events_studio_received_idx
  on public.asistian_webhook_events(studio_id, received_at desc);

alter table public.asistian_webhook_events enable row level security;

revoke all on table public.asistian_webhook_events from public, anon;
grant select on table public.asistian_webhook_events to authenticated;
grant select, insert, update on table public.asistian_webhook_events to service_role;

drop policy if exists asistian_webhook_events_admin_select
  on public.asistian_webhook_events;

create policy asistian_webhook_events_admin_select
on public.asistian_webhook_events
for select
to authenticated
using (private.has_capability(studio_id, 'settings.write'));

create or replace function public.admin_set_asistian_to_studio_signing_secret(
  target_studio_id uuid,
  target_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := trim(coalesce(target_secret, ''));
  v_secret_name text;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if length(v_secret) < 12 then
    raise exception 'secret_invalid';
  end if;

  v_secret_name := 'asistian_to_studio_signing_secret:' || target_studio_id::text;

  select s.id
    into v_secret_id
  from vault.secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_secret,
      v_secret_name,
      'Asistian outgoing webhook secret used by Studio Flow receiver'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_secret,
      v_secret_name,
      'Asistian outgoing webhook secret used by Studio Flow receiver'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_asistian_to_studio_signing_secret(uuid,text)
from public, anon, service_role;

grant execute on function public.admin_set_asistian_to_studio_signing_secret(uuid,text)
to authenticated;

create or replace function public.service_get_asistian_to_studio_signing_secret(
  target_studio_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_name text;
  v_secret text;
begin
  v_secret_name := 'asistian_to_studio_signing_secret:' || target_studio_id::text;

  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  return v_secret;
end;
$$;

revoke all on function public.service_get_asistian_to_studio_signing_secret(uuid)
from public, anon, authenticated;

grant execute on function public.service_get_asistian_to_studio_signing_secret(uuid)
to service_role;
