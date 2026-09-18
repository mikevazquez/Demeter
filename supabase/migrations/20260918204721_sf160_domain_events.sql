-- SF-160 · Motor base de eventos de dominio.
-- Fundación interna para automatizaciones, campañas y acciones requeridas.
-- No contiene integración con proveedores de mensajería.

create table public.domain_events (
  event_id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  event_type text not null check (length(trim(event_type)) > 0),
  occurred_at timestamptz not null default now(),
  source_entity_type text not null check (length(trim(source_entity_type)) > 0),
  source_entity_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  deduplication_key text not null check (length(trim(deduplication_key)) > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  correlation_id uuid,
  causation_event_id uuid references public.domain_events(event_id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint domain_events_studio_event_unique unique (studio_id, event_id),
  constraint domain_events_studio_dedup_unique unique (studio_id, deduplication_key)
);

comment on table public.domain_events is
  'SF-160 append-only domain event log. Producers emit facts only; downstream consumers decide effects.';

create index domain_events_studio_occurred_idx
  on public.domain_events(studio_id, occurred_at desc);
create index domain_events_studio_type_occurred_idx
  on public.domain_events(studio_id, event_type, occurred_at desc);
create index domain_events_source_idx
  on public.domain_events(studio_id, source_entity_type, source_entity_id, occurred_at desc);
create index domain_events_actor_user_idx
  on public.domain_events(actor_user_id)
  where actor_user_id is not null;
create index domain_events_causation_idx
  on public.domain_events(causation_event_id)
  where causation_event_id is not null;

create table public.domain_event_consumptions (
  studio_id uuid not null references public.studios(id) on delete restrict,
  event_id uuid not null,
  consumer_key text not null check (length(trim(consumer_key)) > 0),
  claimed_at timestamptz not null default now(),
  primary key (event_id, consumer_key),
  constraint domain_event_consumptions_event_tenant_fkey
    foreign key (studio_id, event_id)
    references public.domain_events(studio_id, event_id)
    on delete restrict
);

comment on table public.domain_event_consumptions is
  'SF-160 idempotency ledger. One claim per event and consumer prevents duplicate downstream effects.';

create index domain_event_consumptions_studio_claimed_idx
  on public.domain_event_consumptions(studio_id, claimed_at desc);

alter table public.domain_events enable row level security;
alter table public.domain_event_consumptions enable row level security;

create policy domain_events_read
on public.domain_events
for select
to authenticated
using (private.has_capability(studio_id, 'reports.read'));

create policy domain_event_consumptions_read
on public.domain_event_consumptions
for select
to authenticated
using (private.has_capability(studio_id, 'reports.read'));

revoke all on table public.domain_events from anon, authenticated;
revoke all on table public.domain_event_consumptions from anon, authenticated;
grant select on table public.domain_events to authenticated;
grant select on table public.domain_event_consumptions to authenticated;
grant select, insert on table public.domain_events to service_role;
grant select, insert on table public.domain_event_consumptions to service_role;

create or replace function private.reject_domain_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'domain_event_immutable';
end;
$$;

revoke all on function private.reject_domain_event_mutation() from public, anon, authenticated;

create trigger domain_events_immutable
before update or delete on public.domain_events
for each row execute function private.reject_domain_event_mutation();

create trigger domain_event_consumptions_immutable
before update or delete on public.domain_event_consumptions
for each row execute function private.reject_domain_event_mutation();

create or replace function public.emit_domain_event(
  p_studio_id uuid,
  p_event_type text,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_deduplication_key text,
  p_occurred_at timestamptz default now(),
  p_actor_user_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_correlation_id uuid default null,
  p_causation_event_id uuid default null,
  p_event_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if p_studio_id is null then
    raise exception 'domain_event_studio_required';
  end if;
  if trim(coalesce(p_event_type, '')) = '' then
    raise exception 'domain_event_type_required';
  end if;
  if trim(coalesce(p_source_entity_type, '')) = '' or p_source_entity_id is null then
    raise exception 'domain_event_source_required';
  end if;
  if trim(coalesce(p_deduplication_key, '')) = '' then
    raise exception 'domain_event_deduplication_key_required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'domain_event_payload_must_be_object';
  end if;

  insert into public.domain_events (
    event_id,
    studio_id,
    event_type,
    occurred_at,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    deduplication_key,
    payload,
    correlation_id,
    causation_event_id
  ) values (
    coalesce(p_event_id, gen_random_uuid()),
    p_studio_id,
    trim(p_event_type),
    coalesce(p_occurred_at, now()),
    trim(p_source_entity_type),
    p_source_entity_id,
    p_actor_user_id,
    trim(p_deduplication_key),
    p_payload,
    p_correlation_id,
    p_causation_event_id
  )
  on conflict (studio_id, deduplication_key) do nothing
  returning event_id into v_event_id;

  if v_event_id is null then
    select e.event_id
      into v_event_id
    from public.domain_events e
    where e.studio_id = p_studio_id
      and e.deduplication_key = trim(p_deduplication_key);
  end if;

  return v_event_id;
end;
$$;

revoke all on function public.emit_domain_event(
  uuid, text, text, uuid, text, timestamptz, uuid, jsonb, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.emit_domain_event(
  uuid, text, text, uuid, text, timestamptz, uuid, jsonb, uuid, uuid, uuid
) to service_role;

create or replace function public.claim_domain_event(
  p_event_id uuid,
  p_consumer_key text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_rows integer;
begin
  if trim(coalesce(p_consumer_key, '')) = '' then
    raise exception 'domain_event_consumer_required';
  end if;

  select e.studio_id
    into v_studio_id
  from public.domain_events e
  where e.event_id = p_event_id;

  if v_studio_id is null then
    raise exception 'domain_event_not_found';
  end if;

  insert into public.domain_event_consumptions (
    studio_id,
    event_id,
    consumer_key
  ) values (
    v_studio_id,
    p_event_id,
    trim(p_consumer_key)
  )
  on conflict (event_id, consumer_key) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_domain_event(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_domain_event(uuid, text) to service_role;
