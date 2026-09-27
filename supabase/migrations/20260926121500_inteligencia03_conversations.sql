-- INTEL-03 · Conversaciones entrantes y atribución comercial
-- Sandbox first. Production remains untouched until explicitly authorized.

create table if not exists public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider text not null default 'asistian',
  provider_contact_id text,
  contact_name text,
  contact_phone text,
  student_id uuid references public.students(id) on delete set null,
  crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  channel text not null default 'unknown',
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  activity_count integer not null default 1 check (activity_count > 0),
  source text,
  campaign text,
  first_source_event_id uuid references public.asistian_webhook_events(id) on delete set null,
  last_source_event_id uuid references public.asistian_webhook_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_conversations_identity_required
    check (
      nullif(trim(coalesce(provider_contact_id, '')), '') is not null
      or nullif(trim(coalesce(contact_phone, '')), '') is not null
    ),
  constraint crm_conversations_activity_order
    check (last_activity_at >= started_at)
);

create index if not exists crm_conversations_studio_started_idx
  on public.crm_conversations(studio_id, started_at desc);

create index if not exists crm_conversations_provider_contact_idx
  on public.crm_conversations(studio_id, provider, provider_contact_id, started_at desc)
  where provider_contact_id is not null;

create index if not exists crm_conversations_phone_idx
  on public.crm_conversations(studio_id, contact_phone, started_at desc)
  where contact_phone is not null;

create index if not exists crm_conversations_student_idx
  on public.crm_conversations(studio_id, student_id, started_at desc)
  where student_id is not null;

alter table public.crm_conversations enable row level security;

revoke all on table public.crm_conversations from public, anon;
grant select on table public.crm_conversations to authenticated;
grant select, insert, update, delete on table public.crm_conversations to service_role;

drop policy if exists crm_conversations_reports_read on public.crm_conversations;
create policy crm_conversations_reports_read
on public.crm_conversations
for select
to authenticated
using (
  private.has_capability(studio_id, 'reports.read')
  or private.has_capability(studio_id, 'students.read')
);

create or replace function public.service_record_asistian_conversation_activity(
  target_studio_id uuid,
  target_source_event_id uuid,
  target_client_id text,
  target_contact_name text,
  target_phone text,
  target_channel text,
  target_activity_at timestamptz,
  target_source text,
  target_campaign text,
  target_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_client_id text := nullif(trim(coalesce(target_client_id, '')), '');
  v_contact_name text := nullif(trim(coalesce(target_contact_name, '')), '');
  v_phone text := nullif(trim(coalesce(target_phone, '')), '');
  v_channel text := coalesce(nullif(lower(trim(coalesce(target_channel, ''))), ''), 'unknown');
  v_source text := nullif(trim(coalesce(target_source, '')), '');
  v_campaign text := nullif(trim(coalesce(target_campaign, '')), '');
  v_activity_at timestamptz := coalesce(target_activity_at, clock_timestamp());
  v_metadata jsonb := coalesce(target_metadata, '{}'::jsonb);
  v_student_id uuid;
  v_crm_contact_id uuid;
  v_conversation public.crm_conversations%rowtype;
  v_conversation_id uuid;
  v_student_match_count integer := 0;
begin
  if target_studio_id is null or target_source_event_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'invalid_input');
  end if;

  if not private.studio_has_module(target_studio_id, 'integrations') then
    return jsonb_build_object('ok', false, 'reason_code', 'module_disabled');
  end if;

  if v_client_id is null and v_phone is null then
    return jsonb_build_object('ok', false, 'reason_code', 'contact_identity_missing');
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason_code', 'phone_invalid');
  end if;

  if not exists (
    select 1
    from public.asistian_webhook_events e
    where e.id = target_source_event_id
      and e.studio_id = target_studio_id
      and e.event_name = 'conversation_activity'
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'source_event_invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_studio_id::text || ':asistian-conversation:' || coalesce(v_client_id, v_phone),
      0
    )
  );

  if v_client_id is not null then
    select l.student_id
      into v_student_id
    from public.asistian_booking_links l
    where l.studio_id = target_studio_id
      and l.asistian_client_id = v_client_id
      and l.student_id is not null
    order by coalesce(l.last_event_at, l.created_at) desc
    limit 1;
  end if;

  if v_student_id is null and v_phone is not null then
    select count(*)
      into v_student_match_count
    from public.students s
    where s.studio_id = target_studio_id
      and s.phone = v_phone;

    if v_student_match_count = 1 then
      select s.id
        into v_student_id
      from public.students s
      where s.studio_id = target_studio_id
        and s.phone = v_phone
      limit 1;
    end if;
  end if;

  if v_student_id is not null then
    select c.id
      into v_crm_contact_id
    from public.crm_contacts c
    join public.students s
      on s.person_id = c.person_id
     and s.studio_id = c.studio_id
    where c.studio_id = target_studio_id
      and s.id = v_student_id
    order by c.created_at asc
    limit 1;
  end if;

  select c.*
    into v_conversation
  from public.crm_conversations c
  where c.studio_id = target_studio_id
    and c.provider = 'asistian'
    and (
      (v_client_id is not null and c.provider_contact_id = v_client_id)
      or (v_phone is not null and c.contact_phone = v_phone)
    )
    and v_activity_at >= c.started_at
    and v_activity_at < c.started_at + interval '24 hours'
  order by c.started_at desc
  limit 1
  for update;

  if found then
    update public.crm_conversations
    set provider_contact_id = coalesce(provider_contact_id, v_client_id),
        contact_name = coalesce(contact_name, v_contact_name),
        contact_phone = coalesce(contact_phone, v_phone),
        student_id = coalesce(student_id, v_student_id),
        crm_contact_id = coalesce(crm_contact_id, v_crm_contact_id),
        channel = case when channel = 'unknown' then v_channel else channel end,
        last_activity_at = greatest(last_activity_at, v_activity_at),
        activity_count = activity_count + 1,
        source = coalesce(source, v_source),
        campaign = coalesce(campaign, v_campaign),
        last_source_event_id = target_source_event_id,
        metadata = metadata || v_metadata,
        updated_at = clock_timestamp()
    where id = v_conversation.id
    returning id, student_id into v_conversation_id, v_student_id;

    return jsonb_build_object(
      'ok', true,
      'new_conversation', false,
      'conversation_id', v_conversation_id,
      'student_id', v_student_id,
      'started_at', v_conversation.started_at
    );
  end if;

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
    'asistian',
    v_client_id,
    v_contact_name,
    v_phone,
    v_student_id,
    v_crm_contact_id,
    v_channel,
    v_activity_at,
    v_activity_at,
    1,
    v_source,
    v_campaign,
    target_source_event_id,
    target_source_event_id,
    v_metadata
  )
  returning id into v_conversation_id;

  perform public.emit_domain_event(
    p_studio_id => target_studio_id,
    p_event_type => 'conversation.started',
    p_source_entity_type => 'crm_conversation',
    p_source_entity_id => v_conversation_id,
    p_deduplication_key => 'conversation.started:' || v_conversation_id::text,
    p_occurred_at => v_activity_at,
    p_actor_user_id => null,
    p_payload => jsonb_build_object(
      'conversation_id', v_conversation_id,
      'student_id', v_student_id,
      'provider', 'asistian',
      'provider_contact_id', v_client_id,
      'channel', v_channel,
      'source', v_source,
      'campaign', v_campaign
    )
  );

  return jsonb_build_object(
    'ok', true,
    'new_conversation', true,
    'conversation_id', v_conversation_id,
    'student_id', v_student_id,
    'started_at', v_activity_at
  );
end;
$function$;

revoke all on function public.service_record_asistian_conversation_activity(
  uuid, uuid, text, text, text, text, timestamptz, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.service_record_asistian_conversation_activity(
  uuid, uuid, text, text, text, text, timestamptz, text, text, jsonb
) to service_role;

create or replace function private.link_asistian_conversations_from_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_phone text;
  v_crm_contact_id uuid;
begin
  if new.student_id is null then
    return new;
  end if;

  select s.phone
    into v_phone
  from public.students s
  where s.id = new.student_id
    and s.studio_id = new.studio_id;

  select c.id
    into v_crm_contact_id
  from public.crm_contacts c
  join public.students s
    on s.person_id = c.person_id
   and s.studio_id = c.studio_id
  where c.studio_id = new.studio_id
    and s.id = new.student_id
  order by c.created_at asc
  limit 1;

  update public.crm_conversations c
  set student_id = coalesce(c.student_id, new.student_id),
      crm_contact_id = coalesce(c.crm_contact_id, v_crm_contact_id),
      provider_contact_id = coalesce(c.provider_contact_id, new.asistian_client_id),
      updated_at = clock_timestamp()
  where c.studio_id = new.studio_id
    and c.provider = 'asistian'
    and c.student_id is null
    and (
      (new.asistian_client_id is not null and c.provider_contact_id = new.asistian_client_id)
      or (v_phone is not null and c.contact_phone = v_phone)
    );

  return new;
end;
$function$;

revoke all on function private.link_asistian_conversations_from_booking() from public, anon, authenticated;

drop trigger if exists inteligencia03_link_conversations_after_asistian_booking
  on public.asistian_booking_links;

create trigger inteligencia03_link_conversations_after_asistian_booking
after insert or update of asistian_client_id, student_id
on public.asistian_booking_links
for each row
execute function private.link_asistian_conversations_from_booking();
