-- DEMI-378. Dormant until DEMI_ATOMIC_TEXT_SEND_CLAIMS=true in the application.
-- Only service_role may coordinate. No network calls or long-lived DB transactions.
alter table public.assistant_whatsapp_events add column coordination_text text;

create table public.assistant_whatsapp_turn_owners (
  studio_id uuid not null,
  contact_wa_id text not null,
  generation bigint not null default 0,
  current_text_event_id uuid,
  burst_started_at timestamptz,
  last_text_at timestamptz,
  owner_event_id uuid,
  owner_token uuid,
  owner_until timestamptz,
  primary key (studio_id, contact_wa_id)
);

create table public.assistant_whatsapp_send_claims (
  id bigint generated always as identity primary key,
  studio_id uuid not null,
  provider text not null check (provider = 'meta_whatsapp'),
  contact_wa_id text not null,
  inbound_event_id uuid not null,
  claim_token uuid not null unique,
  state text not null default 'reserved'
    check (state in ('reserved', 'dispatching', 'invalidated', 'accepted', 'uncertain', 'failed_final')),
  provider_message_id text,
  claimed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (studio_id, provider, inbound_event_id)
);
create unique index assistant_whatsapp_one_active_claim
  on public.assistant_whatsapp_send_claims (studio_id, provider, contact_wa_id)
  where state in ('reserved', 'dispatching');

create table public.assistant_whatsapp_action_claims (
  studio_id uuid not null,
  event_id uuid not null,
  contact_wa_id text not null,
  action_key text not null,
  owner_token uuid not null,
  state text not null default 'started' check (state in ('started', 'completed')),
  result jsonb,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (studio_id, event_id, action_key)
);
create index assistant_whatsapp_unresolved_actions
  on public.assistant_whatsapp_action_claims (studio_id, contact_wa_id) where state = 'started';

alter table public.assistant_whatsapp_turn_owners enable row level security;
alter table public.assistant_whatsapp_send_claims enable row level security;
alter table public.assistant_whatsapp_action_claims enable row level security;
revoke all on public.assistant_whatsapp_turn_owners, public.assistant_whatsapp_send_claims,
  public.assistant_whatsapp_action_claims from public, anon, authenticated;
-- Mutations are RPC-only, including for service_role, to enforce token fencing.
grant select on public.assistant_whatsapp_turn_owners, public.assistant_whatsapp_send_claims,
  public.assistant_whatsapp_action_claims to service_role;

-- Immutable canonical contact identity. Do not rewrite the original event/history.
create function public.assistant_whatsapp_contact_key(p_contact text)
returns text language sql immutable strict set search_path = '' as $$
  select case when p_contact ~ '^521[0-9]{10}$' then '52' || substring(p_contact from 4) else p_contact end
$$;

-- AFTER INSERT runs only for a genuinely inserted event, never ON CONFLICT/replays.
-- The row lock serializes ingestion, ownership, action admission and send authorization.
create function public.assistant_whatsapp_lock_inbound_text()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_contact text := public.assistant_whatsapp_contact_key(new.contact_wa_id);
  v_now timestamptz := clock_timestamp();
begin
  if new.provider <> 'meta_whatsapp' or new.contact_wa_id is null then return new; end if;
  insert into public.assistant_whatsapp_turn_owners(studio_id, contact_wa_id)
    values (new.studio_id, v_contact) on conflict do nothing;
  perform 1 from public.assistant_whatsapp_turn_owners
    where studio_id = new.studio_id and contact_wa_id = v_contact for update;
  if new.message_type = 'text' then
    update public.assistant_whatsapp_turn_owners
      set generation = generation + 1, current_text_event_id = new.id,
        burst_started_at = case
          when last_text_at is null or last_text_at < v_now - interval '4 seconds'
            or burst_started_at < v_now - interval '12 seconds' then v_now
          else burst_started_at end,
        last_text_at = v_now
      where studio_id = new.studio_id and contact_wa_id = v_contact;
    update public.assistant_whatsapp_send_claims
      set state = 'invalidated', updated_at = v_now
      where studio_id = new.studio_id and contact_wa_id = v_contact and state = 'reserved'
        and exists (select 1 from public.assistant_whatsapp_events e
          where e.id = inbound_event_id and e.message_type = 'text');
  end if;
  return new;
end;
$$;
revoke all on function public.assistant_whatsapp_lock_inbound_text() from public, anon, authenticated;
create trigger assistant_whatsapp_lock_inbound_text
  after insert on public.assistant_whatsapp_events
  for each row execute function public.assistant_whatsapp_lock_inbound_text();

-- Initialize the head for existing conversations without modifying their history.
insert into public.assistant_whatsapp_turn_owners
  (studio_id, contact_wa_id, generation, current_text_event_id, burst_started_at, last_text_at)
select distinct on (studio_id, public.assistant_whatsapp_contact_key(contact_wa_id))
  studio_id, public.assistant_whatsapp_contact_key(contact_wa_id), 1, id, received_at, received_at
from public.assistant_whatsapp_events where provider = 'meta_whatsapp' and message_type = 'text' and contact_wa_id is not null
order by studio_id, public.assistant_whatsapp_contact_key(contact_wa_id), received_at desc, id desc
on conflict do nothing;

create function public.assistant_whatsapp_coordinate(
  p_studio_id uuid, p_event_id uuid, p_token uuid, p_operation text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.assistant_whatsapp_events%rowtype;
  v_owner public.assistant_whatsapp_turn_owners%rowtype;
  v_contact text;
  v_current boolean;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_token is null then raise exception 'token required'; end if;
  select * into v_event from public.assistant_whatsapp_events
    where id = p_event_id and studio_id = p_studio_id and provider = 'meta_whatsapp';
  if not found then return jsonb_build_object('status', 'missing'); end if;
  v_contact := public.assistant_whatsapp_contact_key(v_event.contact_wa_id);
  insert into public.assistant_whatsapp_turn_owners(studio_id, contact_wa_id)
    values (p_studio_id, v_contact) on conflict do nothing;
  select * into v_owner from public.assistant_whatsapp_turn_owners
    where studio_id = p_studio_id and contact_wa_id = v_contact for update;
  v_current := v_event.message_type <> 'text' or v_owner.current_text_event_id = p_event_id;

  if p_operation = 'acquire' then
    if v_owner.owner_token is not null and v_owner.owner_until > v_now then
      return jsonb_build_object('status', 'busy');
    end if;
    -- A crashed processor is recoverable. Its token is fenced on every subsequent operation.
    if v_owner.owner_event_id is not null then
      update public.assistant_whatsapp_events set processing_status = 'error'
        where id = v_owner.owner_event_id and studio_id = p_studio_id and processing_status = 'processing';
    end if;
    -- Once dispatch was authorized, expiry is ambiguous, never a resend permission.
    update public.assistant_whatsapp_send_claims
      set state = case when state = 'dispatching' then 'uncertain' else 'invalidated' end,
        updated_at = v_now
      where studio_id = p_studio_id and contact_wa_id = v_contact
        and state in ('reserved', 'dispatching');
    if exists (select 1 from public.assistant_whatsapp_send_claims
      where studio_id = p_studio_id and inbound_event_id = p_event_id
        and state in ('dispatching', 'uncertain', 'accepted', 'failed_final')) then
      return jsonb_build_object('status', 'sealed');
    end if;
    -- Refresh under the lock: captureEvent may have read the old processing state.
    select * into v_event from public.assistant_whatsapp_events where id = p_event_id;
    if v_event.processing_status in ('processed', 'ignored', 'human_review') then
      return jsonb_build_object('status', 'handled');
    end if;
    update public.assistant_whatsapp_turn_owners
      set owner_event_id = p_event_id, owner_token = p_token, owner_until = v_now + interval '60 seconds'
      where studio_id = p_studio_id and contact_wa_id = v_contact;
    if v_event.processing_status = 'processing' then
      update public.assistant_whatsapp_events set processing_status = 'error' where id = p_event_id;
    end if;
    return jsonb_build_object('status', 'owned');
  end if;

  if v_owner.owner_token is distinct from p_token or v_owner.owner_event_id <> p_event_id then
    return jsonb_build_object('status', 'lost');
  end if;
  if p_operation = 'release' then
    update public.assistant_whatsapp_turn_owners set owner_token = null, owner_event_id = null, owner_until = null
      where studio_id = p_studio_id and contact_wa_id = v_contact;
    -- Recover errors/guard rejection on the next webhook retry; never strand 'processing'.
    update public.assistant_whatsapp_events set processing_status = 'error'
      where id = p_event_id and processing_status = 'processing';
    return jsonb_build_object('status', 'released');
  end if;
  if v_owner.owner_until <= v_now then return jsonb_build_object('status', 'lost'); end if;
  if p_operation = 'renew' then
    update public.assistant_whatsapp_turn_owners set owner_until = v_now + interval '60 seconds'
      where studio_id = p_studio_id and contact_wa_id = v_contact;
  elsif p_operation <> 'current' then raise exception 'invalid operation'; end if;
  return jsonb_build_object('status', case when v_current then 'current' else 'stale' end,
    'current_event_id', v_owner.current_text_event_id,
    'generation', v_owner.generation, 'burst_started_at', v_owner.burst_started_at,
    'last_text_at', v_owner.last_text_at);
end;
$$;

-- Reserve is reversible; authorization is the irreversible dispatch boundary.
create function public.assistant_whatsapp_claim_current_text(
  p_studio_id uuid, p_event_id uuid, p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_status jsonb; v_event public.assistant_whatsapp_events%rowtype;
begin
  v_status := public.assistant_whatsapp_coordinate(p_studio_id, p_event_id, p_claim_token, 'current');
  if v_status->>'status' <> 'current' then return false; end if;
  select * into v_event from public.assistant_whatsapp_events where id = p_event_id;
  insert into public.assistant_whatsapp_send_claims
    (studio_id, provider, contact_wa_id, inbound_event_id, claim_token)
    values (p_studio_id, 'meta_whatsapp', public.assistant_whatsapp_contact_key(v_event.contact_wa_id), p_event_id, p_claim_token)
    on conflict (studio_id, provider, inbound_event_id) do update
      set claim_token = excluded.claim_token, state = 'reserved', updated_at = clock_timestamp()
      where assistant_whatsapp_send_claims.state = 'invalidated';
  return found;
end;
$$;

create function public.assistant_whatsapp_authorize_text_send(
  p_studio_id uuid, p_event_id uuid, p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_status jsonb;
begin
  v_status := public.assistant_whatsapp_coordinate(p_studio_id, p_event_id, p_claim_token, 'current');
  if v_status->>'status' <> 'current' then return false; end if;
  update public.assistant_whatsapp_send_claims set state = 'dispatching', updated_at = clock_timestamp()
    where studio_id = p_studio_id and inbound_event_id = p_event_id
      and claim_token = p_claim_token and state = 'reserved';
  return found;
end;
$$;

create function public.assistant_whatsapp_finish_text_claim(
  p_claim_token uuid, p_state text, p_provider_message_id text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('accepted', 'uncertain', 'failed_final') then
    raise exception 'invalid terminal state' using errcode = '22023';
  end if;
  if p_state = 'accepted' and nullif(p_provider_message_id, '') is null then
    raise exception 'accepted requires provider receipt';
  end if;
  update public.assistant_whatsapp_send_claims set state = p_state,
    provider_message_id = coalesce(provider_message_id, p_provider_message_id), updated_at = clock_timestamp()
    where claim_token = p_claim_token
      and (state = 'dispatching' or state = p_state or (state = 'uncertain' and p_state = 'accepted'))
      and (provider_message_id is null or provider_message_id = p_provider_message_id);
  return found;
end;
$$;

-- Every action (including receipt handlers) is admitted before calling business code.
-- No automatic replay of a started action: a crash can hide an externally accepted effect.
create function public.assistant_whatsapp_claim_action(
  p_studio_id uuid, p_event_id uuid, p_token uuid, p_action_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status jsonb; v_contact text; v_action public.assistant_whatsapp_action_claims%rowtype;
begin
  v_status := public.assistant_whatsapp_coordinate(p_studio_id, p_event_id, p_token, 'current');
  if v_status->>'status' <> 'current' then return jsonb_build_object('status', 'stale'); end if;
  select public.assistant_whatsapp_contact_key(contact_wa_id) into v_contact
    from public.assistant_whatsapp_events where id = p_event_id;
  select * into v_action from public.assistant_whatsapp_action_claims
    where studio_id = p_studio_id and event_id = p_event_id and action_key = p_action_key;
  if found then
    return jsonb_build_object('status', v_action.state, 'result', v_action.result);
  end if;
  if exists (select 1 from public.assistant_whatsapp_action_claims
    where studio_id = p_studio_id and contact_wa_id = v_contact and state = 'started') then
    return jsonb_build_object('status', 'uncertain');
  end if;
  insert into public.assistant_whatsapp_action_claims(studio_id, event_id, contact_wa_id, action_key, owner_token)
    values (p_studio_id, p_event_id, v_contact, p_action_key, p_token);
  return jsonb_build_object('status', 'claimed');
end;
$$;
create function public.assistant_whatsapp_finish_action(
  p_studio_id uuid, p_event_id uuid, p_token uuid, p_action_key text, p_result jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  -- A late original owner may record the result, but can never execute again.
  update public.assistant_whatsapp_action_claims set state = 'completed', result = p_result,
    completed_at = clock_timestamp() where studio_id = p_studio_id and event_id = p_event_id
      and action_key = p_action_key and owner_token = p_token and state = 'started';
  return found;
end;
$$;

revoke all on function public.assistant_whatsapp_contact_key(text) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_contact_key(text) to service_role;
revoke all on function public.assistant_whatsapp_coordinate(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_coordinate(uuid, uuid, uuid, text) to service_role;
revoke all on function public.assistant_whatsapp_claim_current_text(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_claim_current_text(uuid, uuid, uuid) to service_role;
revoke all on function public.assistant_whatsapp_authorize_text_send(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_authorize_text_send(uuid, uuid, uuid) to service_role;
revoke all on function public.assistant_whatsapp_finish_text_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_finish_text_claim(uuid, text, text) to service_role;
revoke all on function public.assistant_whatsapp_claim_action(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_claim_action(uuid, uuid, uuid, text) to service_role;
revoke all on function public.assistant_whatsapp_finish_action(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.assistant_whatsapp_finish_action(uuid, uuid, uuid, text, jsonb) to service_role;
