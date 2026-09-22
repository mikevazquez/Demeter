alter table public.class_templates
  add column if not exists requires_resource boolean not null default false;

alter table public.class_sessions
  add column if not exists requires_resource boolean not null default false,
  add column if not exists resource_uses_per_item integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.class_sessions'::regclass
      and conname = 'class_sessions_resource_uses_per_item_positive'
  ) then
    alter table public.class_sessions
      add constraint class_sessions_resource_uses_per_item_positive
      check (resource_uses_per_item > 0);
  end if;
end
$$;

create table if not exists public.resource_types (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  key text not null,
  name text not null,
  icon_key text,
  color_hex text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_types_key_nonempty check (btrim(key) <> ''),
  constraint resource_types_name_nonempty check (btrim(name) <> ''),
  constraint resource_types_key_format check (key ~ '^[a-z0-9][a-z0-9_-]*$'),
  constraint resource_types_color_hex_format check (
    color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'
  ),
  unique (studio_id, key),
  unique (studio_id, id)
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete restrict,
  resource_type_id uuid not null references public.resource_types(id) on delete restrict,
  name text not null,
  short_label text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resources_name_nonempty check (btrim(name) <> ''),
  constraint resources_short_label_nonempty check (
    short_label is null or btrim(short_label) <> ''
  ),
  unique (space_id, name),
  unique (studio_id, space_id, id)
);

create table if not exists public.space_maps (
  space_id uuid primary key references public.spaces(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  canvas_width integer not null default 1000 check (canvas_width > 0),
  canvas_height integer not null default 700 check (canvas_height > 0),
  revision integer not null default 1 check (revision > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, space_id)
);

create table if not exists public.space_map_elements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  space_id uuid not null references public.space_maps(space_id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  element_kind text not null,
  label text,
  x numeric(8,6) not null,
  y numeric(8,6) not null,
  width numeric(8,6) not null,
  height numeric(8,6) not null,
  rotation_degrees numeric(7,3) not null default 0,
  z_index integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint space_map_elements_kind_nonempty check (btrim(element_kind) <> ''),
  constraint space_map_elements_x_range check (x >= 0 and x <= 1),
  constraint space_map_elements_y_range check (y >= 0 and y <= 1),
  constraint space_map_elements_width_range check (width > 0 and width <= 1),
  constraint space_map_elements_height_range check (height > 0 and height <= 1),
  constraint space_map_elements_rotation_range check (
    rotation_degrees >= 0 and rotation_degrees < 360
  ),
  constraint space_map_elements_resource_shape check (
    (element_kind = 'resource' and resource_id is not null)
    or (element_kind <> 'resource' and resource_id is null)
  )
);

create unique index if not exists space_map_elements_resource_unique
  on public.space_map_elements(resource_id)
  where resource_id is not null;

create table if not exists public.session_resources (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete restrict,
  enabled boolean not null default true,
  capacity_override integer check (capacity_override is null or capacity_override > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, resource_id),
  unique (studio_id, session_id, resource_id)
);

create table if not exists public.reservation_resource_assignments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  constraint reservation_resource_assignment_release_pair check (
    (released_at is null and release_reason is null)
    or released_at is not null
  )
);

create unique index if not exists reservation_resource_assignments_one_active_per_reservation
  on public.reservation_resource_assignments(reservation_id)
  where released_at is null;

create index if not exists resource_types_studio_active_idx
  on public.resource_types(studio_id, active, sort_order);
create index if not exists resources_studio_space_active_idx
  on public.resources(studio_id, space_id, active);
create index if not exists resources_type_idx
  on public.resources(resource_type_id);
create index if not exists space_map_elements_space_idx
  on public.space_map_elements(studio_id, space_id, z_index);
create index if not exists session_resources_session_enabled_idx
  on public.session_resources(studio_id, session_id, enabled);
create index if not exists session_resources_resource_idx
  on public.session_resources(resource_id);
create index if not exists reservation_resource_assignments_active_resource_idx
  on public.reservation_resource_assignments(studio_id, session_id, resource_id)
  where released_at is null;

create or replace function private.recursos01_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.recursos01_touch_updated_at()
from public, anon, authenticated, service_role;

drop trigger if exists resource_types_touch_updated_at on public.resource_types;
create trigger resource_types_touch_updated_at
before update on public.resource_types
for each row execute function private.recursos01_touch_updated_at();

drop trigger if exists resources_touch_updated_at on public.resources;
create trigger resources_touch_updated_at
before update on public.resources
for each row execute function private.recursos01_touch_updated_at();

drop trigger if exists space_maps_touch_updated_at on public.space_maps;
create trigger space_maps_touch_updated_at
before update on public.space_maps
for each row execute function private.recursos01_touch_updated_at();

drop trigger if exists space_map_elements_touch_updated_at on public.space_map_elements;
create trigger space_map_elements_touch_updated_at
before update on public.space_map_elements
for each row execute function private.recursos01_touch_updated_at();

drop trigger if exists session_resources_touch_updated_at on public.session_resources;
create trigger session_resources_touch_updated_at
before update on public.session_resources
for each row execute function private.recursos01_touch_updated_at();

create or replace function private.recursos01_validate_resource()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_studio_id uuid;
  v_type_studio_id uuid;
begin
  select studio_id into v_space_studio_id
  from public.spaces
  where id = new.space_id;

  if v_space_studio_id is null or v_space_studio_id <> new.studio_id then
    raise exception 'resource_space_studio_mismatch';
  end if;

  select studio_id into v_type_studio_id
  from public.resource_types
  where id = new.resource_type_id;

  if v_type_studio_id is null or v_type_studio_id <> new.studio_id then
    raise exception 'resource_type_studio_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_validate_resource()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_validate_resource on public.resources;
create trigger recursos01_validate_resource
before insert or update of studio_id, space_id, resource_type_id
on public.resources
for each row execute function private.recursos01_validate_resource();

create or replace function private.recursos01_validate_space_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_studio_id uuid;
begin
  select studio_id into v_space_studio_id
  from public.spaces
  where id = new.space_id;

  if v_space_studio_id is null or v_space_studio_id <> new.studio_id then
    raise exception 'space_map_studio_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_validate_space_map()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_validate_space_map on public.space_maps;
create trigger recursos01_validate_space_map
before insert or update of studio_id, space_id
on public.space_maps
for each row execute function private.recursos01_validate_space_map();

create or replace function private.recursos01_validate_map_element()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map_studio_id uuid;
  v_resource record;
begin
  select studio_id into v_map_studio_id
  from public.space_maps
  where space_id = new.space_id;

  if v_map_studio_id is null or v_map_studio_id <> new.studio_id then
    raise exception 'map_element_space_studio_mismatch';
  end if;

  if new.resource_id is not null then
    select studio_id, space_id into v_resource
    from public.resources
    where id = new.resource_id;

    if not found
      or v_resource.studio_id <> new.studio_id
      or v_resource.space_id <> new.space_id then
      raise exception 'map_element_resource_mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_validate_map_element()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_validate_map_element on public.space_map_elements;
create trigger recursos01_validate_map_element
before insert or update of studio_id, space_id, resource_id, element_kind
on public.space_map_elements
for each row execute function private.recursos01_validate_map_element();

create or replace function private.recursos01_validate_session_resource()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_resource record;
begin
  select studio_id, space_id, requires_resource into v_session
  from public.class_sessions
  where id = new.session_id;

  if not found or v_session.studio_id <> new.studio_id then
    raise exception 'session_resource_session_studio_mismatch';
  end if;

  if not v_session.requires_resource then
    raise exception 'session_does_not_require_resource';
  end if;

  if v_session.space_id is null then
    raise exception 'resource_session_requires_space';
  end if;

  select studio_id, space_id, active into v_resource
  from public.resources
  where id = new.resource_id;

  if not found
    or v_resource.studio_id <> new.studio_id
    or v_resource.space_id <> v_session.space_id then
    raise exception 'session_resource_space_mismatch';
  end if;

  if not v_resource.active and new.enabled then
    raise exception 'inactive_resource_cannot_be_enabled';
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_validate_session_resource()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_validate_session_resource on public.session_resources;
create trigger recursos01_validate_session_resource
before insert or update of studio_id, session_id, resource_id, enabled
on public.session_resources
for each row execute function private.recursos01_validate_session_resource();

create or replace function private.recursos01_guard_session_resource_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_default_capacity integer;
  v_effective_capacity integer;
begin
  if tg_op = 'UPDATE'
    and (new.studio_id, new.session_id, new.resource_id)
      is distinct from
      (old.studio_id, old.session_id, old.resource_id) then
    raise exception 'session_resource_identity_is_immutable';
  end if;

  select count(*)::integer into v_active_count
  from public.reservation_resource_assignments a
  where a.studio_id = old.studio_id
    and a.session_id = old.session_id
    and a.resource_id = old.resource_id
    and a.released_at is null;

  if tg_op = 'DELETE' then
    if v_active_count > 0 then
      raise exception 'resource_has_active_assignments';
    end if;
    return old;
  end if;

  if old.enabled and not new.enabled and v_active_count > 0 then
    raise exception 'resource_has_active_assignments';
  end if;

  select resource_uses_per_item into v_default_capacity
  from public.class_sessions
  where id = new.session_id;

  v_effective_capacity := coalesce(new.capacity_override, v_default_capacity, 1);

  if new.enabled and v_active_count > v_effective_capacity then
    raise exception 'resource_capacity_below_active_assignments';
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_guard_session_resource_change()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_guard_session_resource_change on public.session_resources;
create trigger recursos01_guard_session_resource_change
before update or delete on public.session_resources
for each row execute function private.recursos01_guard_session_resource_change();

create or replace function private.recursos01_guard_session_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict boolean;
begin
  if old.requires_resource and not new.requires_resource then
    select exists (
      select 1
      from public.reservation_resource_assignments a
      where a.session_id = old.id
        and a.released_at is null
    ) into v_conflict;

    if v_conflict then
      raise exception 'session_has_active_resource_assignments';
    end if;
  end if;

  if new.resource_uses_per_item <> old.resource_uses_per_item then
    select exists (
      select 1
      from public.session_resources sr
      where sr.session_id = old.id
        and sr.enabled
        and sr.capacity_override is null
        and (
          select count(*)
          from public.reservation_resource_assignments a
          where a.session_id = old.id
            and a.resource_id = sr.resource_id
            and a.released_at is null
        ) > new.resource_uses_per_item
    ) into v_conflict;

    if v_conflict then
      raise exception 'session_resource_capacity_below_active_assignments';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_guard_session_capacity()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_guard_session_capacity on public.class_sessions;
create trigger recursos01_guard_session_capacity
before update of requires_resource, resource_uses_per_item
on public.class_sessions
for each row execute function private.recursos01_guard_session_capacity();

create or replace function private.recursos01_guard_resource_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_future_assignments boolean;
begin
  if old.active and not new.active then
    select exists (
      select 1
      from public.reservation_resource_assignments a
      join public.class_sessions cs on cs.id = a.session_id
      where a.resource_id = old.id
        and a.released_at is null
        and cs.starts_at > now()
    ) into v_has_future_assignments;

    if v_has_future_assignments then
      raise exception 'resource_has_future_assignments';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_guard_resource_deactivation()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_guard_resource_deactivation on public.resources;
create trigger recursos01_guard_resource_deactivation
before update of active on public.resources
for each row execute function private.recursos01_guard_resource_deactivation();

create or replace function private.recursos01_validate_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation record;
  v_session record;
  v_session_resource record;
  v_resource_active boolean;
  v_capacity integer;
  v_active_count integer;
begin
  select studio_id, session_id, status into v_reservation
  from public.reservations
  where id = new.reservation_id;

  if not found
    or v_reservation.studio_id <> new.studio_id
    or v_reservation.session_id <> new.session_id then
    raise exception 'resource_assignment_reservation_mismatch';
  end if;

  if new.released_at is null
    and v_reservation.status not in ('reserved', 'attended') then
    raise exception 'resource_assignment_requires_active_reservation';
  end if;

  select studio_id, space_id, requires_resource, resource_uses_per_item
    into v_session
  from public.class_sessions
  where id = new.session_id;

  if not found or v_session.studio_id <> new.studio_id then
    raise exception 'resource_assignment_session_mismatch';
  end if;

  if not v_session.requires_resource and new.released_at is null then
    raise exception 'session_does_not_require_resource';
  end if;

  select sr.enabled, sr.capacity_override
    into v_session_resource
  from public.session_resources sr
  where sr.studio_id = new.studio_id
    and sr.session_id = new.session_id
    and sr.resource_id = new.resource_id
  for update;

  if not found then
    raise exception 'resource_not_configured_for_session';
  end if;

  if not v_session_resource.enabled and new.released_at is null then
    raise exception 'resource_not_available_for_session';
  end if;

  select active into v_resource_active
  from public.resources
  where id = new.resource_id
    and studio_id = new.studio_id
    and space_id = v_session.space_id;

  if v_resource_active is distinct from true and new.released_at is null then
    raise exception 'resource_not_active';
  end if;

  if new.released_at is null then
    v_capacity := coalesce(
      v_session_resource.capacity_override,
      v_session.resource_uses_per_item,
      1
    );

    select count(*)::integer into v_active_count
    from public.reservation_resource_assignments a
    where a.studio_id = new.studio_id
      and a.session_id = new.session_id
      and a.resource_id = new.resource_id
      and a.released_at is null
      and a.id <> new.id;

    if v_active_count >= v_capacity then
      raise exception 'resource_full';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_validate_assignment()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_validate_assignment on public.reservation_resource_assignments;
create trigger recursos01_validate_assignment
before insert or update of studio_id, session_id, reservation_id, resource_id, released_at
on public.reservation_resource_assignments
for each row execute function private.recursos01_validate_assignment();

create or replace function private.recursos01_release_assignment_after_reservation_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('reserved', 'attended')
    and new.status not in ('reserved', 'attended') then
    update public.reservation_resource_assignments
    set released_at = coalesce(released_at, now()),
        release_reason = coalesce(release_reason, 'reservation_status:' || new.status::text)
    where reservation_id = new.id
      and released_at is null;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_release_assignment_after_reservation_status()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_release_assignment_after_reservation_status
on public.reservations;
create trigger recursos01_release_assignment_after_reservation_status
after update of status on public.reservations
for each row execute function private.recursos01_release_assignment_after_reservation_status();

alter table public.resource_types enable row level security;
alter table public.resources enable row level security;
alter table public.space_maps enable row level security;
alter table public.space_map_elements enable row level security;
alter table public.session_resources enable row level security;
alter table public.reservation_resource_assignments enable row level security;

drop policy if exists resource_types_select on public.resource_types;
create policy resource_types_select
on public.resource_types
for select
to authenticated
using (private.is_studio_member(studio_id));

drop policy if exists resource_types_write on public.resource_types;
create policy resource_types_write
on public.resource_types
for all
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists resources_select on public.resources;
create policy resources_select
on public.resources
for select
to authenticated
using (private.is_studio_member(studio_id));

drop policy if exists resources_write on public.resources;
create policy resources_write
on public.resources
for all
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists space_maps_select on public.space_maps;
create policy space_maps_select
on public.space_maps
for select
to authenticated
using (private.is_studio_member(studio_id));

drop policy if exists space_maps_write on public.space_maps;
create policy space_maps_write
on public.space_maps
for all
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists space_map_elements_select on public.space_map_elements;
create policy space_map_elements_select
on public.space_map_elements
for select
to authenticated
using (private.is_studio_member(studio_id));

drop policy if exists space_map_elements_write on public.space_map_elements;
create policy space_map_elements_write
on public.space_map_elements
for all
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

drop policy if exists session_resources_select on public.session_resources;
create policy session_resources_select
on public.session_resources
for select
to authenticated
using (private.is_studio_member(studio_id));

drop policy if exists session_resources_write on public.session_resources;
create policy session_resources_write
on public.session_resources
for all
to authenticated
using (private.has_capability(studio_id, 'schedule.write'))
with check (private.has_capability(studio_id, 'schedule.write'));

drop policy if exists resource_assignments_select on public.reservation_resource_assignments;
create policy resource_assignments_select
on public.reservation_resource_assignments
for select
to authenticated
using (
  private.has_capability(studio_id, 'schedule.write')
  or private.is_current_instructor_session(studio_id, session_id)
  or exists (
    select 1
    from public.reservations r
    where r.id = reservation_id
      and (
        r.student_user_id = (select auth.uid())
        or (
          r.student_id is not null
          and private.is_current_student(r.student_id, r.studio_id)
        )
      )
  )
);

drop policy if exists resource_assignments_write on public.reservation_resource_assignments;
create policy resource_assignments_write
on public.reservation_resource_assignments
for all
to authenticated
using (private.has_capability(studio_id, 'schedule.write'))
with check (private.has_capability(studio_id, 'schedule.write'));

grant select, insert, update, delete on public.resource_types to authenticated;
grant select, insert, update, delete on public.resources to authenticated;
grant select, insert, update, delete on public.space_maps to authenticated;
grant select, insert, update, delete on public.space_map_elements to authenticated;
grant select, insert, update, delete on public.session_resources to authenticated;
grant select, insert, update, delete on public.reservation_resource_assignments to authenticated;

insert into public.resource_types (
  studio_id, key, name, icon_key, sort_order
)
select
  s.id,
  v.key,
  v.name,
  v.icon_key,
  v.sort_order
from public.studios s
cross join (
  values
    ('pole', 'Pole', 'pole', 10),
    ('aerial_hoop', 'Aro', 'aerial-hoop', 20),
    ('aerial_silk', 'Tela', 'aerial-silk', 30),
    ('aerial_spiral', 'Espiral', 'aerial-spiral', 40),
    ('pendulum', 'Péndulo', 'pendulum', 50),
    ('other', 'Otro', 'other', 100)
) as v(key, name, icon_key, sort_order)
on conflict (studio_id, key) do nothing;

create or replace function private.recursos01_seed_default_resource_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.resource_types (
    studio_id, key, name, icon_key, sort_order
  )
  values
    (new.id, 'pole', 'Pole', 'pole', 10),
    (new.id, 'aerial_hoop', 'Aro', 'aerial-hoop', 20),
    (new.id, 'aerial_silk', 'Tela', 'aerial-silk', 30),
    (new.id, 'aerial_spiral', 'Espiral', 'aerial-spiral', 40),
    (new.id, 'pendulum', 'Péndulo', 'pendulum', 50),
    (new.id, 'other', 'Otro', 'other', 100)
  on conflict (studio_id, key) do nothing;

  return new;
end;
$$;

revoke all on function private.recursos01_seed_default_resource_types()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_seed_default_resource_types on public.studios;
create trigger recursos01_seed_default_resource_types
after insert on public.studios
for each row execute function private.recursos01_seed_default_resource_types();

comment on table public.resource_types is
  'RECURSOS-01 configurable resource categories per studio.';
comment on table public.resources is
  'RECURSOS-01 physical reservable resources. Identity is stable even when map position changes.';
comment on table public.space_maps is
  'RECURSOS-01 single map geometry source per studio space.';
comment on table public.space_map_elements is
  'RECURSOS-01 normalized visual geometry for references and resources.';
comment on table public.session_resources is
  'RECURSOS-01 per-session resource availability. Geometry remains global.';
comment on table public.reservation_resource_assignments is
  'RECURSOS-01 reservation-to-resource allocation with release history and capacity enforcement.';
