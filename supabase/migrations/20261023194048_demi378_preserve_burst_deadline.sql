-- Keep the first message's deadline across sustained input. Reset only on quiet
-- or on authorized dispatch; a stream at the 12s boundary must not restart waiting.
create or replace function public.assistant_whatsapp_lock_inbound_text()
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
          when burst_started_at is null or last_text_at is null
            or last_text_at < v_now - interval '4 seconds' then v_now
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
create or replace function public.assistant_whatsapp_authorize_text_send(
  p_studio_id uuid, p_event_id uuid, p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_status jsonb;
begin
  v_status := public.assistant_whatsapp_coordinate(p_studio_id, p_event_id, p_claim_token, 'current');
  if v_status->>'status' <> 'current' then return false; end if;
  update public.assistant_whatsapp_send_claims set state = 'dispatching', updated_at = clock_timestamp()
    where studio_id = p_studio_id and inbound_event_id = p_event_id
      and claim_token = p_claim_token and state = 'reserved';
  if not found then return false; end if;
  update public.assistant_whatsapp_turn_owners set burst_started_at = null
    where studio_id = p_studio_id and owner_token = p_claim_token;
  return true;
end;
$$;

