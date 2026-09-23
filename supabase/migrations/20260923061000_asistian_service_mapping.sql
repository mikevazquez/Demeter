-- ASISTIAN-INBOUND-05
-- Stable Asistian service ID -> Studio Flow activity mapping.

create table if not exists public.asistian_service_mappings (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  asistian_service_id text not null,
  asistian_service_name text,
  class_template_id uuid not null references public.class_templates(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asistian_service_mappings_service_id_required
    check (length(trim(asistian_service_id)) > 0),
  constraint asistian_service_mappings_studio_service_unique
    unique (studio_id, asistian_service_id)
);

create index if not exists asistian_service_mappings_template_idx
  on public.asistian_service_mappings(studio_id, class_template_id)
  where active;

alter table public.asistian_service_mappings enable row level security;

revoke all on table public.asistian_service_mappings from public, anon;
grant select on table public.asistian_service_mappings to authenticated;
grant select, insert, update, delete on table public.asistian_service_mappings to service_role;

drop policy if exists asistian_service_mappings_admin_select
  on public.asistian_service_mappings;

create policy asistian_service_mappings_admin_select
on public.asistian_service_mappings
for select
to authenticated
using (
  private.has_capability(studio_id, 'settings.write')
  or private.has_capability(studio_id, 'schedule.write')
);

alter table public.asistian_booking_links
  add column if not exists asistian_service_id text;

create index if not exists asistian_booking_links_service_id_idx
  on public.asistian_booking_links(studio_id, asistian_service_id)
  where asistian_service_id is not null;

comment on table public.asistian_service_mappings is
  'Stable mapping from an Asistian service ID to a Studio Flow class template/activity.';
comment on column public.asistian_booking_links.asistian_service_id is
  'Native Asistian service ID captured with the external booking.';

create or replace function public.admin_upsert_asistian_service_mapping(
  target_studio_id uuid,
  target_service_id text,
  target_service_name text,
  target_class_template_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_id text := trim(coalesce(target_service_id, ''));
  v_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_mapping_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_capability(target_studio_id, 'settings.write') then
    raise exception 'forbidden';
  end if;

  if v_service_id = '' or target_class_template_id is null then
    raise exception 'mapping_invalid';
  end if;

  if not exists (
    select 1
    from public.class_templates ct
    where ct.id = target_class_template_id
      and ct.studio_id = target_studio_id
      and ct.active
  ) then
    raise exception 'class_template_invalid';
  end if;

  insert into public.asistian_service_mappings(
    studio_id,
    asistian_service_id,
    asistian_service_name,
    class_template_id,
    active
  )
  values (
    target_studio_id,
    v_service_id,
    v_service_name,
    target_class_template_id,
    true
  )
  on conflict (studio_id, asistian_service_id)
  do update set
    asistian_service_name = coalesce(
      excluded.asistian_service_name,
      public.asistian_service_mappings.asistian_service_name
    ),
    class_template_id = excluded.class_template_id,
    active = true,
    updated_at = now()
  returning id into v_mapping_id;

  return v_mapping_id;
end;
$$;

revoke all on function public.admin_upsert_asistian_service_mapping(uuid,text,text,uuid)
from public, anon, service_role;

grant execute on function public.admin_upsert_asistian_service_mapping(uuid,text,text,uuid)
to authenticated;

create or replace function private.asistian_mapped_service_name(
  target_studio_id uuid,
  target_service_id text,
  fallback_service_name text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_service_id text := nullif(trim(coalesce(target_service_id, '')), '');
  v_name text;
begin
  if v_service_id is not null then
    select ct.name
      into v_name
    from public.asistian_service_mappings m
    join public.class_templates ct
      on ct.id = m.class_template_id
     and ct.studio_id = m.studio_id
    where m.studio_id = target_studio_id
      and m.asistian_service_id = v_service_id
      and m.active
      and ct.active
    limit 1;
  end if;

  return coalesce(v_name, nullif(trim(coalesce(fallback_service_name, '')), ''));
end;
$$;

revoke all on function private.asistian_mapped_service_name(uuid,text,text)
from public, anon, authenticated;

grant execute on function private.asistian_mapped_service_name(uuid,text,text)
to service_role;

create or replace function public.service_sync_asistian_booking(
  target_studio_id uuid,
  target_source_event_id uuid,
  target_booking_id text,
  target_client_id text,
  target_first_name text,
  target_last_name text,
  target_phone text,
  target_service_id text,
  target_service_name text,
  target_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_id text := nullif(trim(coalesce(target_service_id, '')), '');
  v_external_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_resolved_service_name text;
  v_mapping_used boolean := false;
  v_result jsonb;
begin
  v_resolved_service_name := private.asistian_mapped_service_name(
    target_studio_id,
    v_service_id,
    v_external_service_name
  );

  if v_service_id is not null then
    select exists (
      select 1
      from public.asistian_service_mappings m
      where m.studio_id = target_studio_id
        and m.asistian_service_id = v_service_id
        and m.active
    ) into v_mapping_used;
  end if;

  v_result := public.service_sync_asistian_booking(
    target_studio_id,
    target_source_event_id,
    target_booking_id,
    target_client_id,
    target_first_name,
    target_last_name,
    target_phone,
    v_resolved_service_name,
    target_starts_at
  );

  if v_service_id is not null then
    update public.asistian_booking_links
    set asistian_service_id = v_service_id,
        service_name = coalesce(v_external_service_name, service_name)
    where studio_id = target_studio_id
      and asistian_booking_id = trim(coalesce(target_booking_id, ''));
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'service_mapping_used', v_mapping_used,
    'asistian_service_id', v_service_id
  );
end;
$$;

revoke all on function public.service_sync_asistian_booking(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz
)
from public, anon, authenticated;

grant execute on function public.service_sync_asistian_booking(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz
)
to service_role;

create or replace function public.service_apply_asistian_booking_event(
  target_studio_id uuid,
  target_source_event_id uuid,
  target_event_name text,
  target_booking_id text,
  target_service_id text,
  target_service_name text,
  target_starts_at timestamptz,
  target_external_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_id text := nullif(trim(coalesce(target_service_id, '')), '');
  v_external_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_resolved_service_name text;
  v_mapping_used boolean := false;
  v_result jsonb;
begin
  v_resolved_service_name := private.asistian_mapped_service_name(
    target_studio_id,
    v_service_id,
    v_external_service_name
  );

  if v_service_id is not null then
    select exists (
      select 1
      from public.asistian_service_mappings m
      where m.studio_id = target_studio_id
        and m.asistian_service_id = v_service_id
        and m.active
    ) into v_mapping_used;
  end if;

  v_result := public.service_apply_asistian_booking_event(
    target_studio_id,
    target_source_event_id,
    target_event_name,
    target_booking_id,
    v_resolved_service_name,
    target_starts_at,
    target_external_status
  );

  if v_service_id is not null then
    update public.asistian_booking_links
    set asistian_service_id = v_service_id,
        service_name = coalesce(v_external_service_name, service_name)
    where studio_id = target_studio_id
      and asistian_booking_id = trim(coalesce(target_booking_id, ''));
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'service_mapping_used', v_mapping_used,
    'asistian_service_id', v_service_id
  );
end;
$$;

revoke all on function public.service_apply_asistian_booking_event(
  uuid,uuid,text,text,text,text,timestamptz,text
)
from public, anon, authenticated;

grant execute on function public.service_apply_asistian_booking_event(
  uuid,uuid,text,text,text,text,timestamptz,text
)
to service_role;
