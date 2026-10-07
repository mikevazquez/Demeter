-- Demi Meta Inbox · Instagram + Facebook Messenger
-- Sandbox/UAT first. Production remains untouched until explicit promotion authorization.

alter table public.assistant_conversations
  drop constraint if exists assistant_conversations_channel_check;

alter table public.assistant_conversations
  add constraint assistant_conversations_channel_check
  check (channel in (
    'internal_demo',
    'whatsapp',
    'instagram',
    'facebook_messenger',
    'asistian_shadow'
  ));

create table if not exists public.assistant_channel_identities (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider text not null check (provider in ('meta_whatsapp','instagram','facebook_messenger')),
  provider_account_id text not null,
  provider_contact_id text not null,
  person_id uuid references public.persons(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, studio_id),
  unique (studio_id, provider, provider_account_id, provider_contact_id)
);

create index if not exists assistant_channel_identities_student_idx
  on public.assistant_channel_identities(studio_id, student_id)
  where student_id is not null;
create index if not exists assistant_channel_identities_person_idx
  on public.assistant_channel_identities(studio_id, person_id)
  where person_id is not null;
create index if not exists assistant_channel_identities_crm_idx
  on public.assistant_channel_identities(studio_id, crm_contact_id)
  where crm_contact_id is not null;

create table if not exists public.assistant_meta_inbox_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider text not null check (provider in ('instagram','facebook_messenger')),
  provider_event_id text not null,
  provider_account_id text not null,
  provider_contact_id text not null,
  message_type text not null,
  body_preview text not null default '',
  provider_timestamp timestamptz,
  payload_fingerprint text not null,
  processing_status text not null default 'captured'
    check (processing_status in ('captured','processing','processed','ignored','human_review','error')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  assistant_conversation_id uuid,
  inbound_turn_id uuid,
  outbound_turn_id uuid,
  processing_result jsonb not null default '{}'::jsonb,
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, studio_id),
  unique (studio_id, provider, provider_event_id),
  constraint assistant_meta_inbox_events_conversation_fk
    foreign key (assistant_conversation_id, studio_id)
    references public.assistant_conversations(id, studio_id)
    on delete set null,
  constraint assistant_meta_inbox_events_inbound_turn_fk
    foreign key (inbound_turn_id, studio_id)
    references public.assistant_turns(id, studio_id)
    on delete set null,
  constraint assistant_meta_inbox_events_outbound_turn_fk
    foreign key (outbound_turn_id, studio_id)
    references public.assistant_turns(id, studio_id)
    on delete set null
);

create index if not exists assistant_meta_inbox_events_contact_idx
  on public.assistant_meta_inbox_events(
    studio_id, provider, provider_account_id, provider_contact_id, created_at desc
  );

create table if not exists public.assistant_meta_inbox_deliveries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  event_id uuid not null,
  conversation_id uuid not null,
  turn_id uuid,
  provider text not null check (provider in ('instagram','facebook_messenger')),
  recipient_id text not null,
  provider_message_id text,
  text_fingerprint text not null,
  attempt_number integer not null default 1 check (attempt_number > 0),
  status text not null check (status in ('accepted','error')),
  error_code text,
  http_status integer,
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint assistant_meta_inbox_deliveries_event_fk
    foreign key (event_id, studio_id)
    references public.assistant_meta_inbox_events(id, studio_id)
    on delete cascade,
  constraint assistant_meta_inbox_deliveries_conversation_fk
    foreign key (conversation_id, studio_id)
    references public.assistant_conversations(id, studio_id)
    on delete cascade,
  constraint assistant_meta_inbox_deliveries_turn_fk
    foreign key (turn_id, studio_id)
    references public.assistant_turns(id, studio_id)
    on delete set null
);

create index if not exists assistant_meta_inbox_deliveries_event_idx
  on public.assistant_meta_inbox_deliveries(studio_id, event_id, created_at);

alter table public.assistant_channel_identities enable row level security;
alter table public.assistant_meta_inbox_events enable row level security;
alter table public.assistant_meta_inbox_deliveries enable row level security;

revoke all on table public.assistant_channel_identities from public, anon;
revoke all on table public.assistant_meta_inbox_events from public, anon;
revoke all on table public.assistant_meta_inbox_deliveries from public, anon;

grant select on table public.assistant_channel_identities to authenticated;
grant select on table public.assistant_meta_inbox_events to authenticated;
grant select on table public.assistant_meta_inbox_deliveries to authenticated;

grant select,insert,update,delete on table public.assistant_channel_identities to service_role;
grant select,insert,update,delete on table public.assistant_meta_inbox_events to service_role;
grant select,insert,update,delete on table public.assistant_meta_inbox_deliveries to service_role;

drop policy if exists assistant_channel_identities_admin_read on public.assistant_channel_identities;
create policy assistant_channel_identities_admin_read
on public.assistant_channel_identities
for select to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or private.has_capability(studio_id, 'students.read')
  or private.has_capability(studio_id, 'reports.read')
);

drop policy if exists assistant_meta_inbox_events_admin_read on public.assistant_meta_inbox_events;
create policy assistant_meta_inbox_events_admin_read
on public.assistant_meta_inbox_events
for select to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or private.has_capability(studio_id, 'reports.read')
);

drop policy if exists assistant_meta_inbox_deliveries_admin_read on public.assistant_meta_inbox_deliveries;
create policy assistant_meta_inbox_deliveries_admin_read
on public.assistant_meta_inbox_deliveries
for select to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or private.has_capability(studio_id, 'reports.read')
);

create or replace function public.admin_set_meta_inbox_connection(
  target_studio_id uuid,
  target_page_access_token text,
  target_page_id text,
  target_instagram_access_token text,
  target_instagram_user_id text,
  target_graph_api_version text,
  target_app_secret text,
  target_verify_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_name text := 'meta_inbox_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_existing text;
  v_payload jsonb := '{}'::jsonb;
  v_page_access_token text := trim(coalesce(target_page_access_token, ''));
  v_page_id text := trim(coalesce(target_page_id, ''));
  v_instagram_access_token text := trim(coalesce(target_instagram_access_token, ''));
  v_instagram_user_id text := trim(coalesce(target_instagram_user_id, ''));
  v_graph_api_version text := trim(coalesce(target_graph_api_version, ''));
  v_app_secret text := trim(coalesce(target_app_secret, ''));
  v_verify_token text := trim(coalesce(target_verify_token, ''));
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if length(v_page_access_token) < 20 or length(v_page_access_token) > 8192 then
    raise exception 'meta_page_access_token_invalid';
  end if;
  if v_page_id !~ '^[0-9]{5,32}$' then
    raise exception 'meta_page_id_invalid';
  end if;
  if length(v_instagram_access_token) < 20 or length(v_instagram_access_token) > 8192 then
    raise exception 'meta_instagram_access_token_invalid';
  end if;
  if v_instagram_user_id !~ '^[0-9]{5,32}$' then
    raise exception 'meta_instagram_user_id_invalid';
  end if;
  if v_graph_api_version !~ '^v[0-9]+\.[0-9]+$' then
    raise exception 'meta_graph_api_version_invalid';
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

  select s.id, s.decrypted_secret
    into v_secret_id, v_existing
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_existing is not null and pg_input_is_valid(v_existing, 'jsonb') then
    v_payload := v_existing::jsonb;
    if jsonb_typeof(v_payload) <> 'object' then
      v_payload := '{}'::jsonb;
    end if;
  end if;

  v_payload := v_payload || jsonb_build_object(
    'page_access_token', v_page_access_token,
    'page_id', v_page_id,
    'instagram_access_token', v_instagram_access_token,
    'instagram_user_id', v_instagram_user_id,
    'graph_api_version', v_graph_api_version,
    'app_secret', v_app_secret,
    'verify_token', v_verify_token,
    'pilot_contact_ids', case
      when jsonb_typeof(v_payload->'pilot_contact_ids') = 'object'
        then v_payload->'pilot_contact_ids'
      else jsonb_build_object('instagram', '[]'::jsonb, 'facebook_messenger', '[]'::jsonb)
    end
  );

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload::text,
      v_secret_name,
      'Studio Flow Meta Inbox connection for Instagram and Facebook Messenger'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload::text,
      v_secret_name,
      'Studio Flow Meta Inbox connection for Instagram and Facebook Messenger'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'connected', true,
    'page_id', v_page_id,
    'instagram_user_id', v_instagram_user_id,
    'verify_token', v_verify_token
  );
end;
$function$;

revoke all on function public.admin_set_meta_inbox_connection(
  uuid,text,text,text,text,text,text,text
) from public, anon, service_role;
grant execute on function public.admin_set_meta_inbox_connection(
  uuid,text,text,text,text,text,text,text
) to authenticated;

create or replace function public.admin_set_meta_inbox_pilot_contacts(
  target_studio_id uuid,
  target_instagram_contact_id text default null,
  target_messenger_contact_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_name text := 'meta_inbox_connection:' || target_studio_id::text;
  v_secret_id uuid;
  v_secret text;
  v_payload jsonb;
  v_instagram text := trim(coalesce(target_instagram_contact_id, ''));
  v_messenger text := trim(coalesce(target_messenger_contact_id, ''));
  v_pilot jsonb;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_instagram <> '' and v_instagram !~ '^[0-9]{5,64}$' then
    raise exception 'meta_instagram_pilot_contact_invalid';
  end if;
  if v_messenger <> '' and v_messenger !~ '^[0-9]{5,64}$' then
    raise exception 'meta_messenger_pilot_contact_invalid';
  end if;

  select s.id, s.decrypted_secret
    into v_secret_id, v_secret
  from vault.decrypted_secrets s
  where s.name = v_secret_name
  limit 1;

  if v_secret_id is null or v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    raise exception 'meta_inbox_not_configured';
  end if;

  v_payload := v_secret::jsonb;
  v_pilot := jsonb_build_object(
    'instagram', case when v_instagram = '' then '[]'::jsonb else jsonb_build_array(v_instagram) end,
    'facebook_messenger', case when v_messenger = '' then '[]'::jsonb else jsonb_build_array(v_messenger) end
  );
  v_payload := jsonb_set(v_payload, '{pilot_contact_ids}', v_pilot, true);

  perform vault.update_secret(
    v_secret_id,
    v_payload::text,
    v_secret_name,
    'Studio Flow Meta Inbox connection for Instagram and Facebook Messenger'
  );

  return jsonb_build_object(
    'ok', true,
    'instagram_pilot_configured', v_instagram <> '',
    'messenger_pilot_configured', v_messenger <> ''
  );
end;
$function$;

revoke all on function public.admin_set_meta_inbox_pilot_contacts(uuid,text,text)
from public, anon, service_role;
grant execute on function public.admin_set_meta_inbox_pilot_contacts(uuid,text,text)
to authenticated;

create or replace function public.admin_get_meta_inbox_connection_summary(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
  v_payload jsonb;
  v_pilot jsonb;
  v_instagram_pilot text;
  v_messenger_pilot text;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_inbox_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    return jsonb_build_object('connected', false);
  end if;

  v_payload := v_secret::jsonb;
  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('connected', false);
  end if;

  v_pilot := case
    when jsonb_typeof(v_payload->'pilot_contact_ids') = 'object'
      then v_payload->'pilot_contact_ids'
    else '{}'::jsonb
  end;

  select value into v_instagram_pilot
  from jsonb_array_elements_text(coalesce(v_pilot->'instagram', '[]'::jsonb))
  limit 1;

  select value into v_messenger_pilot
  from jsonb_array_elements_text(coalesce(v_pilot->'facebook_messenger', '[]'::jsonb))
  limit 1;

  return jsonb_build_object(
    'connected',
      nullif(trim(coalesce(v_payload->>'page_access_token', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'page_id', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'instagram_access_token', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'instagram_user_id', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'app_secret', '')), '') is not null
      and nullif(trim(coalesce(v_payload->>'verify_token', '')), '') is not null,
    'page_id', v_payload->>'page_id',
    'instagram_user_id', v_payload->>'instagram_user_id',
    'graph_api_version', v_payload->>'graph_api_version',
    'verify_token', v_payload->>'verify_token',
    'instagram_pilot_masked', case
      when v_instagram_pilot is null then null else '••••' || right(v_instagram_pilot, 4)
    end,
    'messenger_pilot_masked', case
      when v_messenger_pilot is null then null else '••••' || right(v_messenger_pilot, 4)
    end
  );
end;
$function$;

revoke all on function public.admin_get_meta_inbox_connection_summary(uuid)
from public, anon, service_role;
grant execute on function public.admin_get_meta_inbox_connection_summary(uuid)
to authenticated;

create or replace function public.service_get_meta_inbox_webhook_config(
  target_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = 'meta_inbox_connection:' || target_studio_id::text
  limit 1;

  if v_secret is null or not pg_input_is_valid(v_secret, 'jsonb') then
    return null;
  end if;
  if jsonb_typeof(v_secret::jsonb) <> 'object' then
    return null;
  end if;

  return v_secret::jsonb;
end;
$function$;

revoke all on function public.service_get_meta_inbox_webhook_config(uuid)
from public, anon, authenticated;
grant execute on function public.service_get_meta_inbox_webhook_config(uuid)
to service_role;

create or replace function public.service_prepare_meta_inbox_message(
  target_studio_id uuid,
  target_event_id uuid,
  target_provider text,
  target_provider_account_id text,
  target_provider_message_id text,
  target_provider_contact_id text,
  target_display_name text,
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
  v_provider text := lower(trim(coalesce(target_provider, '')));
  v_account_id text := trim(coalesce(target_provider_account_id, ''));
  v_contact_id text := trim(coalesce(target_provider_contact_id, ''));
  v_provider_message_id text := trim(coalesce(target_provider_message_id, ''));
  v_display_name text := nullif(trim(coalesce(target_display_name, '')), '');
  v_message_text text := left(coalesce(target_message_text, ''), 2000);
  v_activity_at timestamptz := coalesce(target_activity_at, clock_timestamp());
  v_identity_id uuid;
  v_person_id uuid;
  v_student_id uuid;
  v_crm_contact_id uuid;
  v_crm_conversation_id uuid;
  v_assistant_conversation_id uuid;
  v_inbound_turn_id uuid;
  v_external_thread_ref text;
  v_existing_status text;
  v_handoff_open boolean := false;
  v_name_parts text[];
  v_student_matches integer := 0;
begin
  if v_provider not in ('instagram','facebook_messenger')
     or v_account_id = ''
     or v_contact_id = ''
     or v_provider_message_id = ''
     or target_event_id is null
     or target_studio_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not exists (
    select 1
    from public.assistant_meta_inbox_events e
    where e.id = target_event_id
      and e.studio_id = target_studio_id
      and e.provider = v_provider
      and e.provider_event_id = v_provider_message_id
      and e.provider_account_id = v_account_id
      and e.provider_contact_id = v_contact_id
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_studio_id::text || ':meta-inbox:' || v_provider || ':' || v_account_id || ':' || v_contact_id,
      0
    )
  );

  select i.id, i.person_id, i.student_id, i.crm_contact_id
    into v_identity_id, v_person_id, v_student_id, v_crm_contact_id
  from public.assistant_channel_identities i
  where i.studio_id = target_studio_id
    and i.provider = v_provider
    and i.provider_account_id = v_account_id
    and i.provider_contact_id = v_contact_id
  limit 1
  for update;

  if v_identity_id is null then
    v_name_parts := regexp_split_to_array(coalesce(v_display_name, 'Prospecto'), '\s+');

    insert into public.persons(studio_id, first_name, last_name)
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

    insert into public.crm_contacts(studio_id, person_id, lifecycle_status, source)
    values (target_studio_id, v_person_id, 'prospect', v_provider)
    returning id into v_crm_contact_id;

    insert into public.assistant_channel_identities(
      studio_id, provider, provider_account_id, provider_contact_id,
      person_id, crm_contact_id, display_name, metadata,
      first_seen_at, last_seen_at
    )
    values (
      target_studio_id, v_provider, v_account_id, v_contact_id,
      v_person_id, v_crm_contact_id, v_display_name,
      jsonb_build_object('verified_student_link', false),
      v_activity_at, v_activity_at
    )
    returning id into v_identity_id;
  else
    if v_person_id is null and v_crm_contact_id is not null then
      select c.person_id into v_person_id
      from public.crm_contacts c
      where c.id = v_crm_contact_id
        and c.studio_id = target_studio_id;
    end if;

    -- Safe passive refresh only when the CRM person already maps uniquely to a student.
    -- No phone typed in Instagram/Messenger is ever treated as authentication.
    if v_student_id is null and v_person_id is not null then
      select count(*) into v_student_matches
      from public.students s
      where s.studio_id = target_studio_id
        and s.person_id = v_person_id;

      if v_student_matches = 1 then
        select s.id into v_student_id
        from public.students s
        where s.studio_id = target_studio_id
          and s.person_id = v_person_id
        limit 1;
      end if;
    end if;

    update public.assistant_channel_identities
    set person_id = coalesce(person_id, v_person_id),
        student_id = coalesce(student_id, v_student_id),
        crm_contact_id = coalesce(crm_contact_id, v_crm_contact_id),
        display_name = coalesce(display_name, v_display_name),
        last_seen_at = greatest(last_seen_at, v_activity_at),
        updated_at = clock_timestamp()
    where id = v_identity_id
      and studio_id = target_studio_id;
  end if;

  select c.id
    into v_crm_conversation_id
  from public.crm_conversations c
  where c.studio_id = target_studio_id
    and c.provider = v_provider
    and c.provider_contact_id = v_contact_id
    and v_activity_at >= c.started_at
    and v_activity_at < c.started_at + interval '24 hours'
  order by c.started_at desc
  limit 1
  for update;

  if v_crm_conversation_id is null then
    insert into public.crm_conversations(
      studio_id, provider, provider_contact_id, contact_name, contact_phone,
      student_id, crm_contact_id, channel, started_at, last_activity_at,
      activity_count, source, campaign, first_source_event_id, last_source_event_id, metadata
    )
    values (
      target_studio_id, v_provider, v_contact_id, v_display_name, null,
      v_student_id, v_crm_contact_id, v_provider, v_activity_at, v_activity_at,
      1, v_provider, null, null, null,
      jsonb_build_object(
        'meta_inbox_first_event_id', target_event_id,
        'meta_inbox_last_event_id', target_event_id,
        'provider_account_id', v_account_id,
        'identity_id', v_identity_id
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
        'provider', v_provider,
        'provider_contact_id', v_contact_id,
        'channel', v_provider,
        'source', v_provider
      )
    );
  else
    update public.crm_conversations
    set contact_name = coalesce(contact_name, v_display_name),
        student_id = coalesce(student_id, v_student_id),
        crm_contact_id = coalesce(crm_contact_id, v_crm_contact_id),
        last_activity_at = greatest(last_activity_at, v_activity_at),
        activity_count = activity_count + 1,
        metadata = metadata || jsonb_build_object(
          'meta_inbox_last_event_id', target_event_id,
          'provider_account_id', v_account_id,
          'identity_id', v_identity_id
        ),
        updated_at = clock_timestamp()
    where id = v_crm_conversation_id;
  end if;

  v_external_thread_ref := v_account_id || ':' || v_contact_id;

  select ac.id, ac.status
    into v_assistant_conversation_id, v_existing_status
  from public.assistant_conversations ac
  where ac.studio_id = target_studio_id
    and ac.channel = v_provider
    and ac.external_thread_ref = v_external_thread_ref
  limit 1
  for update;

  if v_assistant_conversation_id is null then
    insert into public.assistant_conversations(
      studio_id, channel, external_thread_ref, crm_conversation_id,
      student_id, status, context, started_at, last_activity_at
    )
    values (
      target_studio_id, v_provider, v_external_thread_ref, v_crm_conversation_id,
      v_student_id, 'open',
      jsonb_build_object(
        'identity_id', v_identity_id,
        'crm_contact_id', v_crm_contact_id,
        'provider', v_provider,
        'provider_account_id', v_account_id,
        'provider_contact_id', v_contact_id,
        'verified_student_link', v_student_id is not null
      ),
      v_activity_at, v_activity_at
    )
    returning id into v_assistant_conversation_id;
  else
    update public.assistant_conversations
    set crm_conversation_id = v_crm_conversation_id,
        student_id = coalesce(student_id, v_student_id),
        context = context || jsonb_build_object(
          'identity_id', v_identity_id,
          'crm_contact_id', v_crm_contact_id,
          'provider', v_provider,
          'provider_account_id', v_account_id,
          'provider_contact_id', v_contact_id,
          'verified_student_link', v_student_id is not null
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
    studio_id, conversation_id, direction, role, content,
    sanitized, channel_message_ref, created_at
  )
  values (
    target_studio_id, v_assistant_conversation_id, 'inbound', 'user',
    v_message_text, true, v_provider_message_id, v_activity_at
  )
  on conflict (studio_id, channel_message_ref)
  where channel_message_ref is not null
  do nothing
  returning id into v_inbound_turn_id;

  if v_inbound_turn_id is null then
    select t.id into v_inbound_turn_id
    from public.assistant_turns t
    where t.studio_id = target_studio_id
      and t.channel_message_ref = v_provider_message_id
    limit 1;
  end if;

  update public.assistant_meta_inbox_events
  set assistant_conversation_id = v_assistant_conversation_id,
      inbound_turn_id = v_inbound_turn_id,
      updated_at = clock_timestamp()
  where id = target_event_id
    and studio_id = target_studio_id;

  return jsonb_build_object(
    'ok', true,
    'identity_id', v_identity_id,
    'student_id', v_student_id,
    'crm_contact_id', v_crm_contact_id,
    'crm_conversation_id', v_crm_conversation_id,
    'assistant_conversation_id', v_assistant_conversation_id,
    'inbound_turn_id', v_inbound_turn_id,
    'handoff_open', v_handoff_open,
    'identity_needs_name', v_display_name is null
  );
end;
$function$;

revoke all on function public.service_prepare_meta_inbox_message(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.service_prepare_meta_inbox_message(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz
) to service_role;

-- Keep WhatsApp in the same cross-channel identity registry without changing its runtime.
insert into public.assistant_channel_identities(
  studio_id, provider, provider_account_id, provider_contact_id,
  person_id, student_id, crm_contact_id, display_name, metadata,
  first_seen_at, last_seen_at
)
select
  e.studio_id,
  'meta_whatsapp',
  e.phone_number_id,
  e.contact_wa_id,
  coalesce(s.person_id, crm.person_id),
  ac.student_id,
  cc.crm_contact_id,
  cc.contact_name,
  jsonb_build_object('backfilled_from_whatsapp', true),
  min(e.received_at),
  max(e.received_at)
from public.assistant_whatsapp_events e
join public.assistant_conversations ac
  on ac.id = e.assistant_conversation_id
 and ac.studio_id = e.studio_id
left join public.crm_conversations cc
  on cc.id = ac.crm_conversation_id
 and cc.studio_id = ac.studio_id
left join public.students s
  on s.id = ac.student_id
 and s.studio_id = ac.studio_id
left join public.crm_contacts crm
  on crm.id = cc.crm_contact_id
 and crm.studio_id = cc.studio_id
where e.assistant_conversation_id is not null
  and e.phone_number_id is not null
  and e.contact_wa_id is not null
group by
  e.studio_id, e.phone_number_id, e.contact_wa_id,
  s.person_id, crm.person_id, ac.student_id, cc.crm_contact_id, cc.contact_name
on conflict (studio_id, provider, provider_account_id, provider_contact_id)
do update
set person_id = coalesce(assistant_channel_identities.person_id, excluded.person_id),
    student_id = coalesce(assistant_channel_identities.student_id, excluded.student_id),
    crm_contact_id = coalesce(assistant_channel_identities.crm_contact_id, excluded.crm_contact_id),
    display_name = coalesce(assistant_channel_identities.display_name, excluded.display_name),
    first_seen_at = least(assistant_channel_identities.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(assistant_channel_identities.last_seen_at, excluded.last_seen_at),
    updated_at = clock_timestamp();

create or replace function private.sync_assistant_whatsapp_channel_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_person_id uuid;
  v_student_id uuid;
  v_crm_contact_id uuid;
  v_display_name text;
begin
  if new.assistant_conversation_id is null
     or new.phone_number_id is null
     or new.contact_wa_id is null then
    return new;
  end if;

  select
    coalesce(s.person_id, crm.person_id),
    ac.student_id,
    cc.crm_contact_id,
    cc.contact_name
  into v_person_id, v_student_id, v_crm_contact_id, v_display_name
  from public.assistant_conversations ac
  left join public.crm_conversations cc
    on cc.id = ac.crm_conversation_id
   and cc.studio_id = ac.studio_id
  left join public.students s
    on s.id = ac.student_id
   and s.studio_id = ac.studio_id
  left join public.crm_contacts crm
    on crm.id = cc.crm_contact_id
   and crm.studio_id = cc.studio_id
  where ac.id = new.assistant_conversation_id
    and ac.studio_id = new.studio_id
  limit 1;

  insert into public.assistant_channel_identities(
    studio_id, provider, provider_account_id, provider_contact_id,
    person_id, student_id, crm_contact_id, display_name, metadata,
    first_seen_at, last_seen_at
  )
  values (
    new.studio_id, 'meta_whatsapp', new.phone_number_id, new.contact_wa_id,
    v_person_id, v_student_id, v_crm_contact_id, v_display_name,
    jsonb_build_object('synced_from_whatsapp', true),
    coalesce(new.provider_timestamp, new.received_at, clock_timestamp()),
    coalesce(new.provider_timestamp, new.received_at, clock_timestamp())
  )
  on conflict (studio_id, provider, provider_account_id, provider_contact_id)
  do update
  set person_id = coalesce(assistant_channel_identities.person_id, excluded.person_id),
      student_id = coalesce(assistant_channel_identities.student_id, excluded.student_id),
      crm_contact_id = coalesce(assistant_channel_identities.crm_contact_id, excluded.crm_contact_id),
      display_name = coalesce(assistant_channel_identities.display_name, excluded.display_name),
      last_seen_at = greatest(assistant_channel_identities.last_seen_at, excluded.last_seen_at),
      updated_at = clock_timestamp();

  return new;
end;
$function$;

revoke all on function private.sync_assistant_whatsapp_channel_identity()
from public, anon, authenticated;

drop trigger if exists demi_sync_whatsapp_channel_identity
  on public.assistant_whatsapp_events;
create trigger demi_sync_whatsapp_channel_identity
after insert or update of assistant_conversation_id
on public.assistant_whatsapp_events
for each row
execute function private.sync_assistant_whatsapp_channel_identity();
