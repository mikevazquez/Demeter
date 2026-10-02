-- Demi · Meta WhatsApp inbound foundation.
-- Sandbox-first, additive only. Existing Asistian inbound/outbound flows remain untouched.

create table if not exists public.assistant_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider text not null default 'meta_whatsapp'
    check (provider = 'meta_whatsapp'),
  provider_event_id text not null,
  phone_number_id text not null,
  contact_wa_id text,
  message_type text not null,
  body_preview text,
  media_id text,
  provider_timestamp timestamptz,
  payload_fingerprint text not null,
  assistant_conversation_id uuid,
  inbound_turn_id uuid,
  outbound_turn_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processing_status text not null default 'captured'
    check (processing_status in (
      'captured','processing','processed','ignored','human_review','error'
    )),
  processing_result jsonb not null default '{}'::jsonb,
  last_error_code text,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (studio_id, provider, provider_event_id),
  constraint assistant_whatsapp_events_conversation_fk
    foreign key (assistant_conversation_id, studio_id)
    references public.assistant_conversations(id, studio_id)
    on delete set null,
  constraint assistant_whatsapp_events_inbound_turn_fk
    foreign key (inbound_turn_id, studio_id)
    references public.assistant_turns(id, studio_id)
    on delete set null,
  constraint assistant_whatsapp_events_outbound_turn_fk
    foreign key (outbound_turn_id, studio_id)
    references public.assistant_turns(id, studio_id)
    on delete set null
);

create index if not exists assistant_whatsapp_events_studio_received_idx
  on public.assistant_whatsapp_events(studio_id, received_at desc);

create index if not exists assistant_whatsapp_events_retry_idx
  on public.assistant_whatsapp_events(studio_id, processing_status, updated_at)
  where processing_status in ('captured','error');

create unique index if not exists assistant_turns_channel_message_unique_idx
  on public.assistant_turns(studio_id, channel_message_ref)
  where channel_message_ref is not null;

create table if not exists public.assistant_whatsapp_deliveries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  event_id uuid references public.assistant_whatsapp_events(id) on delete set null,
  conversation_id uuid not null,
  turn_id uuid,
  recipient_wa_id text not null,
  provider_message_id text,
  text_fingerprint text not null,
  attempt_number integer not null default 1 check (attempt_number > 0),
  status text not null check (status in ('accepted','error')),
  error_code text,
  http_status integer,
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint assistant_whatsapp_deliveries_conversation_fk
    foreign key (conversation_id, studio_id)
    references public.assistant_conversations(id, studio_id)
    on delete cascade,
  constraint assistant_whatsapp_deliveries_turn_fk
    foreign key (turn_id, studio_id)
    references public.assistant_turns(id, studio_id)
    on delete set null
);

create unique index if not exists assistant_whatsapp_deliveries_provider_message_idx
  on public.assistant_whatsapp_deliveries(studio_id, provider_message_id)
  where provider_message_id is not null;

create index if not exists assistant_whatsapp_deliveries_event_idx
  on public.assistant_whatsapp_deliveries(studio_id, event_id, created_at desc);

alter table public.assistant_whatsapp_events enable row level security;
alter table public.assistant_whatsapp_deliveries enable row level security;

revoke all on table public.assistant_whatsapp_events from public, anon, authenticated;
revoke all on table public.assistant_whatsapp_deliveries from public, anon, authenticated;

grant select on table public.assistant_whatsapp_events to authenticated;
grant select on table public.assistant_whatsapp_deliveries to authenticated;
grant select, insert, update, delete on table public.assistant_whatsapp_events to service_role;
grant select, insert, update, delete on table public.assistant_whatsapp_deliveries to service_role;

drop policy if exists assistant_whatsapp_events_admin_read
  on public.assistant_whatsapp_events;
create policy assistant_whatsapp_events_admin_read
on public.assistant_whatsapp_events
for select to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists assistant_whatsapp_deliveries_admin_read
  on public.assistant_whatsapp_deliveries;
create policy assistant_whatsapp_deliveries_admin_read
on public.assistant_whatsapp_deliveries
for select to authenticated
using (private.has_capability(studio_id, 'settings.write'));

create or replace function public.admin_set_meta_whatsapp_inbound(
  target_studio_id uuid,
  target_app_secret text,
  target_verify_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_name text := 'meta_whatsapp_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_payload jsonb;
  v_app_secret text := trim(coalesce(target_app_secret, ''));
  v_verify_token text := trim(coalesce(target_verify_token, ''));
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if length(v_app_secret) < 16 or length(v_app_secret) > 512 then
    raise exception 'meta_app_secret_invalid';
  end if;

  if v_verify_token = '' then
    v_verify_token :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');
  end if;

  if length(v_verify_token) < 16
     or length(v_verify_token) > 128
     or v_verify_token !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'meta_verify_token_invalid';
  end if;

  select s.id, s.decrypted_secret::jsonb
    into v_secret_id, v_payload
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null or v_payload is null then
    raise exception 'meta_whatsapp_not_configured';
  end if;

  if nullif(trim(coalesce(v_payload->>'phone_number_id', '')), '') is null
     or nullif(trim(coalesce(v_payload->>'access_token', '')), '') is null then
    raise exception 'meta_whatsapp_connection_incomplete';
  end if;

  v_payload := jsonb_set(v_payload, '{app_secret}', to_jsonb(v_app_secret), true);
  v_payload := jsonb_set(v_payload, '{verify_token}', to_jsonb(v_verify_token), true);

  perform vault.update_secret(
    v_secret_id,
    v_payload::text,
    v_secret_name,
    'Studio Flow direct Meta WhatsApp Cloud API connection'
  );

  return jsonb_build_object(
    'ok', true,
    'configured', true,
    'phone_number_id', v_payload->>'phone_number_id',
    'verify_token', v_verify_token
  );
end;
$function$;

revoke all on function public.admin_set_meta_whatsapp_inbound(uuid,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_meta_whatsapp_inbound(uuid,text,text)
to authenticated;

create or replace function public.admin_get_meta_whatsapp_inbound_summary(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_payload is null then
    return jsonb_build_object(
      'connected', false,
      'webhook_configured', false
    );
  end if;

  return jsonb_build_object(
    'connected', true,
    'webhook_configured',
      nullif(trim(coalesce(v_payload->>'app_secret', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'verify_token', '')), '') is not null,
    'phone_number_id', v_payload->>'phone_number_id',
    'verify_token', v_payload->>'verify_token'
  );
end;
$function$;

revoke all on function public.admin_get_meta_whatsapp_inbound_summary(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_meta_whatsapp_inbound_summary(uuid)
to authenticated;

create or replace function public.service_get_meta_whatsapp_webhook_config(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret::jsonb
    into v_payload
  from vault.decrypted_secrets s
  where s.name = 'meta_whatsapp_connection:' || target_studio_id::text
  limit 1;

  if v_payload is null then
    return null;
  end if;

  return jsonb_build_object(
    'access_token', v_payload->>'access_token',
    'phone_number_id', v_payload->>'phone_number_id',
    'graph_api_version', v_payload->>'graph_api_version',
    'country_calling_code', coalesce(v_payload->>'country_calling_code', '52'),
    'app_secret', v_payload->>'app_secret',
    'verify_token', v_payload->>'verify_token'
  );
end;
$function$;

revoke all on function public.service_get_meta_whatsapp_webhook_config(uuid)
from public, anon, authenticated;
grant execute on function public.service_get_meta_whatsapp_webhook_config(uuid)
to service_role;

create or replace function public.service_prepare_meta_whatsapp_message(
  target_studio_id uuid,
  target_event_id uuid,
  target_provider_message_id text,
  target_wa_id text,
  target_profile_name text,
  target_message_type text,
  target_message_text text,
  target_activity_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_message_id text := trim(coalesce(target_provider_message_id, ''));
  v_wa_id text := regexp_replace(coalesce(target_wa_id, ''), '[^0-9]', '', 'g');
  v_match_digits text;
  v_phone text;
  v_profile_name text := nullif(trim(coalesce(target_profile_name, '')), '');
  v_message_type text := lower(trim(coalesce(target_message_type, '')));
  v_message_text text := trim(coalesce(target_message_text, ''));
  v_activity_at timestamptz := coalesce(target_activity_at, clock_timestamp());
  v_student_id uuid;
  v_student_matches integer := 0;
  v_person_id uuid;
  v_crm_contact_id uuid;
  v_crm_conversation_id uuid;
  v_assistant_conversation_id uuid;
  v_inbound_turn_id uuid;
  v_handoff_open boolean := false;
  v_existing_status text;
  v_name_parts text[];
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null
     or target_event_id is null
     or v_provider_message_id = ''
     or v_wa_id !~ '^[1-9][0-9]{7,14}$'
     or v_message_type = ''
     or v_message_text = '' then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.assistant_whatsapp_events e
    where e.id = target_event_id
      and e.studio_id = target_studio_id
      and e.provider = 'meta_whatsapp'
      and e.provider_event_id = v_provider_message_id
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  -- Meta historically returned 521XXXXXXXXXX for some Mexican numbers.
  -- Canonicalize that legacy representation to 52XXXXXXXXXX.
  v_match_digits :=
    case
      when v_wa_id ~ '^521[0-9]{10}$' then '52' || substring(v_wa_id from 4)
      else v_wa_id
    end;
  v_phone := '+' || v_match_digits;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_studio_id::text || ':meta-whatsapp:' || v_match_digits,
      0
    )
  );

  select count(*)
    into v_student_matches
  from public.students s
  where s.studio_id = target_studio_id
    and (
      case
        when regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
          then '52' || substring(
            regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') from 4
          )
        else regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
      end
    ) = v_match_digits;

  if v_student_matches = 1 then
    select s.id, s.person_id
      into v_student_id, v_person_id
    from public.students s
    where s.studio_id = target_studio_id
      and (
        case
          when regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
            then '52' || substring(
              regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') from 4
            )
          else regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
        end
      ) = v_match_digits
    limit 1;

    if v_person_id is not null then
      select c.id
        into v_crm_contact_id
      from public.crm_contacts c
      where c.studio_id = target_studio_id
        and c.person_id = v_person_id
      order by c.created_at asc
      limit 1;
    end if;
  end if;

  if v_crm_contact_id is null then
    select c.crm_contact_id
      into v_crm_contact_id
    from public.crm_conversations c
    where c.studio_id = target_studio_id
      and c.provider = 'meta_whatsapp'
      and c.contact_phone = v_phone
      and c.crm_contact_id is not null
    order by c.last_activity_at desc
    limit 1;
  end if;

  if v_student_id is null and v_crm_contact_id is null then
    v_name_parts := regexp_split_to_array(
      coalesce(v_profile_name, 'Prospecto'),
      '\\s+'
    );

    insert into public.persons(
      studio_id,
      first_name,
      last_name
    )
    values (
      target_studio_id,
      left(coalesce(nullif(v_name_parts[1], ''), 'Prospecto'), 120),
      nullif(left(
        case
          when array_length(v_name_parts, 1) > 1
            then array_to_string(v_name_parts[2:array_length(v_name_parts, 1)], ' ')
          else ''
        end,
        180
      ), '')
    )
    returning id into v_person_id;

    insert into public.crm_contacts(
      studio_id,
      person_id,
      lifecycle_status,
      source
    )
    values (
      target_studio_id,
      v_person_id,
      'prospect',
      'meta_whatsapp'
    )
    returning id into v_crm_contact_id;
  end if;

  select c.id
    into v_crm_conversation_id
  from public.crm_conversations c
  where c.studio_id = target_studio_id
    and c.provider = 'meta_whatsapp'
    and c.provider_contact_id = v_wa_id
    and v_activity_at >= c.started_at
    and v_activity_at < c.started_at + interval '24 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_crm_conversation_id is null then
    insert into public.crm_conversations(
      studio_id,
      provider,
      provider_contact_id,
      contact_name,
      contact_phone,
      student_id,
      crm_contact_id,
      channel,
      started_at,
      last_activity_at,
      activity_count,
      source,
      campaign,
      first_source_event_id,
      last_source_event_id,
      metadata
    )
    values (
      target_studio_id,
      'meta_whatsapp',
      v_wa_id,
      v_profile_name,
      v_phone,
      v_student_id,
      v_crm_contact_id,
      'whatsapp',
      v_activity_at,
      v_activity_at,
      1,
      'meta_whatsapp',
      null,
      null,
      null,
      jsonb_build_object(
        'meta_first_event_id', target_event_id,
        'meta_last_event_id', target_event_id
      )
    )
    returning id into v_crm_conversation_id;

    perform public.emit_domain_event(
      p_studio_id => target_studio_id,
      p_event_type => 'conversation.started',
      p_source_entity_type => 'crm_conversation',
      p_source_entity_id => v_crm_conversation_id,
      p_deduplication_key => 'conversation.started:' || v_crm_conversation_id::text,
      p_occurred_at => v_activity_at,
      p_actor_user_id => null,
      p_payload => jsonb_build_object(
        'conversation_id', v_crm_conversation_id,
        'student_id', v_student_id,
        'provider', 'meta_whatsapp',
        'provider_contact_id', v_wa_id,
        'channel', 'whatsapp',
        'source', 'meta_whatsapp'
      )
    );
  else
    update public.crm_conversations
    set contact_name = coalesce(contact_name, v_profile_name),
        contact_phone = coalesce(contact_phone, v_phone),
        student_id = coalesce(student_id, v_student_id),
        crm_contact_id = coalesce(crm_contact_id, v_crm_contact_id),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        activity_count = activity_count + 1,
        metadata = metadata || jsonb_build_object(
          'meta_last_event_id', target_event_id
        ),
        updated_at = clock_timestamp()
    where id = v_crm_conversation_id;
  end if;

  select ac.id, ac.status
    into v_assistant_conversation_id, v_existing_status
  from public.assistant_conversations ac
  where ac.studio_id = target_studio_id
    and ac.channel = 'whatsapp'
    and ac.external_thread_ref = v_wa_id
  limit 1
  for update;

  if v_assistant_conversation_id is null then
    insert into public.assistant_conversations(
      studio_id,
      channel,
      external_thread_ref,
      crm_conversation_id,
      student_id,
      status,
      context
    )
    values (
      target_studio_id,
      'whatsapp',
      v_wa_id,
      v_crm_conversation_id,
      v_student_id,
      'open',
      case
        when v_crm_contact_id is not null
          then jsonb_build_object(
            'crm_contact_id', v_crm_contact_id,
            'contact_phone', v_phone,
            'provider', 'meta_whatsapp'
          )
        else jsonb_build_object(
          'contact_phone', v_phone,
          'provider', 'meta_whatsapp'
        )
      end
    )
    returning id into v_assistant_conversation_id;
  else
    update public.assistant_conversations
    set crm_conversation_id = v_crm_conversation_id,
        student_id = coalesce(student_id, v_student_id),
        context = context || jsonb_build_object(
          'crm_contact_id', v_crm_contact_id,
          'contact_phone', v_phone,
          'provider', 'meta_whatsapp'
        ),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        updated_at = clock_timestamp()
    where id = v_assistant_conversation_id;
  end if;

  select exists (
    select 1
    from public.assistant_handoffs h
    where h.studio_id = target_studio_id
      and h.conversation_id = v_assistant_conversation_id
      and h.status = 'open'
  ) into v_handoff_open;

  if not v_handoff_open and coalesce(v_existing_status, 'open') = 'closed' then
    update public.assistant_conversations
    set status = 'open',
        updated_at = clock_timestamp()
    where id = v_assistant_conversation_id;
  end if;

  insert into public.assistant_turns(
    studio_id,
    conversation_id,
    direction,
    role,
    content,
    sanitized,
    channel_message_ref,
    created_at
  )
  values (
    target_studio_id,
    v_assistant_conversation_id,
    'inbound',
    'user',
    left(v_message_text, 2000),
    true,
    v_provider_message_id,
    v_activity_at
  )
  on conflict (studio_id, channel_message_ref)
  where channel_message_ref is not null
  do nothing
  returning id into v_inbound_turn_id;

  if v_inbound_turn_id is null then
    select t.id
      into v_inbound_turn_id
    from public.assistant_turns t
    where t.studio_id = target_studio_id
      and t.channel_message_ref = v_provider_message_id
    limit 1;
  end if;

  update public.assistant_whatsapp_events
  set assistant_conversation_id = v_assistant_conversation_id,
      inbound_turn_id = v_inbound_turn_id,
      updated_at = clock_timestamp()
  where id = target_event_id
    and studio_id = target_studio_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', v_student_id,
    'crm_contact_id', v_crm_contact_id,
    'crm_conversation_id', v_crm_conversation_id,
    'assistant_conversation_id', v_assistant_conversation_id,
    'inbound_turn_id', v_inbound_turn_id,
    'handoff_open', v_handoff_open,
    'phone_e164', v_phone
  );
end;
$function$;

revoke all on function public.service_prepare_meta_whatsapp_message(
  uuid,uuid,text,text,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.service_prepare_meta_whatsapp_message(
  uuid,uuid,text,text,text,text,text,timestamptz
) to service_role;
