-- DEMI-378: additive, dormant atomic claim for outbound text delivery.
-- No webhook calls this function until the application integration is reviewed.
create table if not exists public.assistant_whatsapp_send_claims (
  id bigint generated always as identity primary key,
  studio_id uuid not null,
  provider text not null,
  contact_wa_id text not null,
  inbound_event_id uuid not null,
  claim_token uuid not null,
  state text not null default 'claimed'
    check (state in ('claimed', 'accepted', 'uncertain', 'failed_final')),
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, provider, inbound_event_id),
  unique (claim_token)
);

create unique index if not exists assistant_whatsapp_one_active_claim
  on public.assistant_whatsapp_send_claims (studio_id, provider, contact_wa_id)
  where state in ('claimed', 'uncertain');

alter table public.assistant_whatsapp_send_claims enable row level security;
revoke all on public.assistant_whatsapp_send_claims from public, anon, authenticated;
grant select, insert, update on public.assistant_whatsapp_send_claims to service_role;
grant usage, select on sequence public.assistant_whatsapp_send_claims_id_seq to service_role;

-- Inbound capture and claim must share the same transaction-level lock.
-- This serializes a committed inbound with an outbound claim acquisition.
create or replace function public.assistant_whatsapp_lock_inbound_text()
returns trigger
language plpgsql
set search_path = ''
as $
begin
  if new.provider = 'meta_whatsapp' and new.message_type = 'text' then
    perform pg_advisory_xact_lock(
      hashtextextended(new.studio_id::text || ':meta_whatsapp:' || new.contact_wa_id, 378)
    );
  end if;
  return new;
end;
$;

drop trigger if exists assistant_whatsapp_lock_inbound_text
  on public.assistant_whatsapp_events;
create trigger assistant_whatsapp_lock_inbound_text
before insert on public.assistant_whatsapp_events
for each row execute function public.assistant_whatsapp_lock_inbound_text();

create or replace function public.assistant_whatsapp_claim_current_text(
  p_studio_id uuid,
  p_event_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.assistant_whatsapp_events%rowtype;
  v_newer_exists boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  select * into v_event
  from public.assistant_whatsapp_events
  where id = p_event_id
    and studio_id = p_studio_id
    and provider = 'meta_whatsapp'
    and message_type = 'text';
  if not found then return false; end if;

  -- Serialize claims and inbound-event visibility checks per studio/contact.
  perform pg_advisory_xact_lock(
    hashtextextended(p_studio_id::text || ':meta_whatsapp:' || v_event.contact_wa_id, 378)
  );

  select exists (
    select 1 from public.assistant_whatsapp_events e
    where e.studio_id = p_studio_id
      and e.provider = 'meta_whatsapp'
      and e.contact_wa_id = v_event.contact_wa_id
      and e.message_type = 'text'
      and e.received_at > v_event.received_at
  ) into v_newer_exists;
  if v_newer_exists then return false; end if;

  if exists (
    select 1 from public.assistant_whatsapp_send_claims c
    where c.studio_id = p_studio_id
      and c.provider = 'meta_whatsapp'
      and c.contact_wa_id = v_event.contact_wa_id
      and c.state in ('claimed', 'uncertain')
  ) then return false; end if;

  insert into public.assistant_whatsapp_send_claims (
    studio_id, provider, contact_wa_id, inbound_event_id, claim_token
  ) values (
    p_studio_id, 'meta_whatsapp', v_event.contact_wa_id, p_event_id, p_claim_token
  ) on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.assistant_whatsapp_claim_current_text(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_claim_current_text(uuid, uuid, uuid)
  to service_role;

-- Claims and inbound insertion now share a transaction lock. A new message arriving
-- AFTER claim commit may still precede the external HTTP send: do not interpret
-- the claim as a cancellable delivery or an exactly-once provider guarantee.
-- Application integration and concurrency tests are mandatory before activation.
