-- Run only against Studio Flow Sandbox (hedouonyhynuvwbckdlg).
-- Synthetic conversation rows only; every write is rolled back. No transport calls.
begin;
set local role service_role;

do $test$
declare
  studio uuid;
  conversation uuid := gen_random_uuid();
  other_conversation uuid := gen_random_uuid();
  events uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                         gen_random_uuid(), gen_random_uuid()];
  turns uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                        gen_random_uuid(), gen_random_uuid()];
  latest uuid;
  affected integer;
  item integer;
begin
  -- Existing UAT studios contain synthetic data and are separate from source studios.
  select r.studio_id into studio
  from public.demi_uat_runs r
  where r.studio_id <> r.source_studio_id
  order by r.created_at desc limit 1;
  if studio is null then raise exception 'synthetic_uat_studio_required'; end if;

  insert into public.assistant_conversations(id, studio_id, channel, external_thread_ref)
  values
    (conversation, studio, 'whatsapp', 'uat-whatsapp-reply-order-309-main'),
    (other_conversation, studio, 'whatsapp', 'uat-whatsapp-reply-order-309-other');

  for item in 1..5 loop
    insert into public.assistant_turns(id, studio_id, conversation_id, direction, role, content)
    values (turns[item], studio,
      case when item = 5 then other_conversation else conversation end,
      'inbound', 'user', 'Mensaje sintético UAT: no enviar');
    insert into public.assistant_whatsapp_events(
      id, studio_id, provider, provider_event_id, phone_number_id, contact_wa_id,
      message_type, payload_fingerprint, assistant_conversation_id, inbound_turn_id,
      provider_timestamp, received_at
    ) values (
      events[item], studio, 'meta_whatsapp', 'uat-whatsapp-reply-order-309-' || item,
      'UAT-NO-TRANSPORT', null, case when item = 3 then 'image' else 'text' end,
      'synthetic', case when item = 5 then other_conversation else conversation end,
      case when item = 4 then null else turns[item] end,
      '2026-10-16T12:00:00Z'::timestamptz,
      '2026-10-16T12:00:00Z'::timestamptz + item * interval '1 millisecond'
    );

    -- The same filters and ordering used by isWhatsAppTextTurnSuperseded.
    select e.id into latest
    from public.assistant_whatsapp_events e
    where e.studio_id = studio and e.provider = 'meta_whatsapp'
      and e.assistant_conversation_id = conversation
      and e.message_type in ('text', 'button', 'interactive')
      and e.inbound_turn_id is not null
    order by e.received_at desc, e.id desc limit 1;

    if latest is distinct from events[least(item, 2)] then
      raise exception 'latest_prepared_text_assertion_failed_at_%', item;
    end if;
  end loop;

  -- A studio filter cannot pick another tenant's events.
  select e.id into latest
  from public.assistant_whatsapp_events e
  where e.studio_id = gen_random_uuid() and e.assistant_conversation_id = conversation
    and e.provider = 'meta_whatsapp' and e.message_type in ('text', 'button', 'interactive')
    and e.inbound_turn_id is not null
  order by e.received_at desc, e.id desc limit 1;
  if latest is not null then raise exception 'tenant_scope_assertion_failed'; end if;

  -- Claim attempt zero, then simulate a definite failure eligible for retry.
  update public.assistant_whatsapp_events
  set processing_status = 'processing', attempt_count = 1
  where studio_id = studio and id = events[1] and attempt_count = 0
    and processing_status in ('captured', 'error');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'initial_claim_assertion_failed'; end if;

  update public.assistant_whatsapp_events set processing_status = 'error'
  where studio_id = studio and id = events[1];

  -- Another request holding the old snapshot must not acquire this later retry.
  update public.assistant_whatsapp_events
  set processing_status = 'processing', attempt_count = 1
  where studio_id = studio and id = events[1] and attempt_count = 0
    and processing_status in ('captured', 'error');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'stale_claim_assertion_failed'; end if;

  update public.assistant_whatsapp_events
  set processing_status = 'processing', attempt_count = 2
  where studio_id = studio and id = events[1] and attempt_count = 1
    and processing_status in ('captured', 'error');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'fresh_retry_assertion_failed'; end if;
end;
$test$;

select jsonb_build_object(
  'assertions_passed', 9,
  'synthetic_only', true,
  'transport_calls', 0,
  'rollback_follows', true
) as result;
rollback;
