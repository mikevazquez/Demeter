
alter table public.class_templates
  add column if not exists resource_uses_per_item integer not null default 1;

alter table public.class_sessions
  add column if not exists resource_config_customized boolean not null default false,
  add column if not exists resource_config_needs_review boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.class_templates'::regclass
      and conname = 'class_templates_resource_uses_per_item_check'
  ) then
    alter table public.class_templates
      add constraint class_templates_resource_uses_per_item_check
      check (resource_uses_per_item between 1 and 20);
  end if;
end
$$;

create table if not exists public.class_template_resources (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  template_id uuid not null references public.class_templates(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  enabled boolean not null default true,
  capacity_override integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_template_resources_template_resource_key unique (template_id, resource_id),
  constraint class_template_resources_capacity_check
    check (capacity_override is null or capacity_override between 1 and 20)
);

create index if not exists class_template_resources_studio_template_idx
  on public.class_template_resources (studio_id, template_id);

create index if not exists class_template_resources_resource_idx
  on public.class_template_resources (resource_id);

alter table public.class_template_resources enable row level security;

drop policy if exists class_template_resources_read
  on public.class_template_resources;
create policy class_template_resources_read
  on public.class_template_resources
  for select
  to authenticated
  using (
    private.has_capability(studio_id, 'schedule.read')
    or private.has_capability(studio_id, 'schedule.write')
  );

drop policy if exists class_template_resources_write
  on public.class_template_resources;
create policy class_template_resources_write
  on public.class_template_resources
  for all
  to authenticated
  using (private.has_capability(studio_id, 'schedule.write'))
  with check (private.has_capability(studio_id, 'schedule.write'));

revoke all on table public.class_template_resources from anon;
grant select, insert, update, delete on table public.class_template_resources to authenticated;

create or replace function private.recursos01_apply_template_defaults_to_session(
  p_session_id uuid,
  p_raise_on_conflict boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_has_template_settings boolean := false;
  v_conflict boolean := false;
begin
  select *
    into v_session
  from public.class_sessions
  where id = p_session_id
  for update;

  if not found then
    if p_raise_on_conflict then
      raise exception 'session_not_found';
    end if;
    return false;
  end if;

  select *
    into v_template
  from public.class_templates
  where id = v_session.template_id
    and studio_id = v_session.studio_id;

  if not found then
    if p_raise_on_conflict then
      raise exception 'template_not_found';
    end if;
    return false;
  end if;

  if v_session.status <> 'scheduled' then
    if p_raise_on_conflict then
      raise exception 'session_not_editable';
    end if;
    return false;
  end if;

  if not v_template.requires_resource then
    v_conflict := exists (
      select 1
      from public.reservation_resource_assignments a
      where a.session_id = v_session.id
        and a.released_at is null
    );

    if v_conflict then
      update public.class_sessions
      set resource_config_needs_review = true
      where id = v_session.id;

      if p_raise_on_conflict then
        raise exception 'resource_defaults_conflict';
      end if;
      return false;
    end if;

    update public.class_sessions
    set
      requires_resource = false,
      resource_uses_per_item = v_template.resource_uses_per_item,
      resource_config_customized = false,
      resource_config_needs_review = false
    where id = v_session.id;

    delete from public.session_resources
    where session_id = v_session.id;

    return true;
  end if;

  if v_session.space_id is null then
    update public.class_sessions
    set resource_config_needs_review = true
    where id = v_session.id;

    if p_raise_on_conflict then
      raise exception 'resource_session_requires_space';
    end if;
    return false;
  end if;

  v_has_template_settings := exists (
    select 1
    from public.class_template_resources ctr
    join public.resources r on r.id = ctr.resource_id
    where ctr.template_id = v_template.id
      and ctr.studio_id = v_template.studio_id
      and r.studio_id = v_template.studio_id
      and r.space_id = v_session.space_id
  );

  v_conflict := exists (
    select 1
    from (
      select
        a.resource_id,
        count(*)::integer as used_count
      from public.reservation_resource_assignments a
      where a.session_id = v_session.id
        and a.released_at is null
      group by a.resource_id
    ) assigned
    left join public.resources r
      on r.id = assigned.resource_id
     and r.studio_id = v_session.studio_id
    left join public.class_template_resources ctr
      on ctr.template_id = v_template.id
     and ctr.studio_id = v_template.studio_id
     and ctr.resource_id = assigned.resource_id
    where
      r.id is null
      or r.space_id is distinct from v_session.space_id
      or not r.active
      or (
        v_has_template_settings
        and coalesce(ctr.enabled, false) = false
      )
      or assigned.used_count >
        case
          when v_has_template_settings
            then coalesce(ctr.capacity_override, v_template.resource_uses_per_item)
          else v_template.resource_uses_per_item
        end
  );

  if v_conflict then
    update public.class_sessions
    set resource_config_needs_review = true
    where id = v_session.id;

    if p_raise_on_conflict then
      raise exception 'resource_defaults_conflict';
    end if;
    return false;
  end if;

  update public.class_sessions
  set
    requires_resource = true,
    resource_uses_per_item = v_template.resource_uses_per_item,
    resource_config_customized = false,
    resource_config_needs_review = false
  where id = v_session.id;

  delete from public.session_resources
  where session_id = v_session.id;

  if v_has_template_settings then
    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    select
      v_session.studio_id,
      v_session.id,
      r.id,
      coalesce(ctr.enabled, false),
      ctr.capacity_override
    from public.resources r
    left join public.class_template_resources ctr
      on ctr.template_id = v_template.id
     and ctr.studio_id = v_template.studio_id
     and ctr.resource_id = r.id
    where r.studio_id = v_session.studio_id
      and r.space_id = v_session.space_id
      and r.active;
  else
    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    select
      v_session.studio_id,
      v_session.id,
      r.id,
      true,
      null
    from public.resources r
    where r.studio_id = v_session.studio_id
      and r.space_id = v_session.space_id
      and r.active;
  end if;

  return true;
end;
$$;

revoke all on function private.recursos01_apply_template_defaults_to_session(uuid, boolean)
from public, anon, authenticated, service_role;

create or replace function private.recursos01_sync_activity_resource_defaults(
  p_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_applied integer := 0;
  v_review integer := 0;
begin
  for v_session_id in
    select cs.id
    from public.class_sessions cs
    where cs.template_id = p_template_id
      and cs.starts_at >= now()
      and cs.status = 'scheduled'
      and not cs.resource_config_customized
    order by cs.starts_at
  loop
    if private.recursos01_apply_template_defaults_to_session(v_session_id, false) then
      v_applied := v_applied + 1;
    else
      v_review := v_review + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'needs_review', v_review
  );
end;
$$;

revoke all on function private.recursos01_sync_activity_resource_defaults(uuid)
from public, anon, authenticated, service_role;

create or replace function private.recursos01_apply_activity_defaults_before_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requires_resource boolean;
  v_resource_uses integer;
begin
  if tg_op = 'INSERT'
     or old.template_id is distinct from new.template_id
     or old.space_id is distinct from new.space_id then
    select ct.requires_resource, ct.resource_uses_per_item
      into v_requires_resource, v_resource_uses
    from public.class_templates ct
    where ct.id = new.template_id
      and ct.studio_id = new.studio_id;

    if found then
      new.requires_resource := v_requires_resource;
      new.resource_uses_per_item := v_resource_uses;
      new.resource_config_customized := false;
      new.resource_config_needs_review := false;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_apply_activity_defaults_before_session()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_apply_activity_defaults_before_session
on public.class_sessions;

create trigger recursos01_apply_activity_defaults_before_session
before insert or update of template_id, space_id
on public.class_sessions
for each row execute function private.recursos01_apply_activity_defaults_before_session();

create or replace function private.recursos01_sync_session_resources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_template_settings boolean := false;
begin
  if not new.requires_resource or new.space_id is null then
    delete from public.session_resources
    where session_id = new.id;
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.space_id is not distinct from new.space_id
    and old.requires_resource = new.requires_resource then
    return new;
  end if;

  delete from public.session_resources
  where session_id = new.id;

  v_has_template_settings := exists (
    select 1
    from public.class_template_resources ctr
    join public.resources r on r.id = ctr.resource_id
    where ctr.template_id = new.template_id
      and ctr.studio_id = new.studio_id
      and r.studio_id = new.studio_id
      and r.space_id = new.space_id
  );

  if v_has_template_settings then
    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    select
      new.studio_id,
      new.id,
      r.id,
      coalesce(ctr.enabled, false),
      ctr.capacity_override
    from public.resources r
    left join public.class_template_resources ctr
      on ctr.template_id = new.template_id
     and ctr.studio_id = new.studio_id
     and ctr.resource_id = r.id
    where r.studio_id = new.studio_id
      and r.space_id = new.space_id
      and r.active;
  else
    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    select
      new.studio_id,
      new.id,
      r.id,
      true,
      null
    from public.resources r
    where r.studio_id = new.studio_id
      and r.space_id = new.space_id
      and r.active;
  end if;

  return new;
end;
$$;

revoke all on function private.recursos01_sync_session_resources()
from public, anon, authenticated, service_role;

drop trigger if exists recursos01_sync_session_resources
on public.class_sessions;

create trigger recursos01_sync_session_resources
after insert or update of space_id, requires_resource
on public.class_sessions
for each row execute function private.recursos01_sync_session_resources();

create or replace function public.admin_save_activity_v2(
  p_studio_id uuid,
  p_activity_id uuid,
  p_name text,
  p_description text,
  p_duration_minutes integer,
  p_capacity integer,
  p_color_hex text,
  p_requires_resource boolean,
  p_drop_in_price_minor integer,
  p_individual_purchase_notes text,
  p_default_instructor_id uuid,
  p_default_space_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_schedules jsonb,
  p_resource_uses_per_item integer,
  p_resource_settings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
  v_item jsonb;
  v_resource_id uuid;
  v_enabled boolean;
  v_capacity_override integer;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not private.has_capability(p_studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if p_resource_uses_per_item is null
     or p_resource_uses_per_item < 1
     or p_resource_uses_per_item > 20 then
    raise exception 'invalid_resource_uses';
  end if;

  if p_resource_settings is null
     or jsonb_typeof(p_resource_settings) <> 'array'
     or jsonb_array_length(p_resource_settings) > 250 then
    raise exception 'invalid_resource_settings';
  end if;

  select public.admin_save_activity(
    p_studio_id,
    p_activity_id,
    p_name,
    p_description,
    p_duration_minutes,
    p_capacity,
    p_color_hex,
    p_requires_resource,
    p_drop_in_price_minor,
    p_individual_purchase_notes,
    p_default_instructor_id,
    p_default_space_id,
    p_starts_on,
    p_ends_on,
    p_schedules
  )
  into v_activity_id;

  update public.class_templates
  set resource_uses_per_item =
    case when p_requires_resource then p_resource_uses_per_item else 1 end
  where id = v_activity_id
    and studio_id = p_studio_id;

  delete from public.class_template_resources
  where template_id = v_activity_id
    and studio_id = p_studio_id;

  if p_requires_resource then
    if p_default_space_id is null then
      raise exception 'resource_activity_requires_space';
    end if;

    if jsonb_array_length(p_resource_settings) = 0 then
      insert into public.class_template_resources (
        studio_id,
        template_id,
        resource_id,
        enabled,
        capacity_override
      )
      select
        p_studio_id,
        v_activity_id,
        r.id,
        true,
        null
      from public.resources r
      where r.studio_id = p_studio_id
        and r.space_id = p_default_space_id
        and r.active;
    else
      for v_item in
        select value
        from jsonb_array_elements(p_resource_settings)
      loop
        v_resource_id := nullif(v_item->>'resource_id', '')::uuid;
        v_enabled := coalesce((v_item->>'enabled')::boolean, false);
        v_capacity_override := case
          when nullif(v_item->>'capacity_override', '') is null then null
          else (v_item->>'capacity_override')::integer
        end;

        if v_resource_id is null then
          raise exception 'invalid_resource_id';
        end if;

        if v_capacity_override is not null
           and (v_capacity_override < 1 or v_capacity_override > 20) then
          raise exception 'invalid_resource_capacity';
        end if;

        if not exists (
          select 1
          from public.resources r
          where r.id = v_resource_id
            and r.studio_id = p_studio_id
            and r.space_id = p_default_space_id
            and r.active
        ) then
          raise exception 'resource_not_in_activity_space';
        end if;

        insert into public.class_template_resources (
          studio_id,
          template_id,
          resource_id,
          enabled,
          capacity_override
        )
        values (
          p_studio_id,
          v_activity_id,
          v_resource_id,
          v_enabled,
          v_capacity_override
        );
      end loop;
    end if;
  end if;

  perform private.recursos01_sync_activity_resource_defaults(v_activity_id);

  return v_activity_id;
end;
$$;

revoke all on function public.admin_save_activity_v2(
  uuid, uuid, text, text, integer, integer, text, boolean, integer, text,
  uuid, uuid, date, date, jsonb, integer, jsonb
) from public, anon;

grant execute on function public.admin_save_activity_v2(
  uuid, uuid, text, text, integer, integer, text, boolean, integer, text,
  uuid, uuid, date, date, jsonb, integer, jsonb
) to authenticated;

create or replace function public.admin_save_session_resources(
  p_session_id uuid,
  p_default_uses integer,
  p_resource_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_item jsonb;
  v_resource_id uuid;
  v_enabled boolean;
  v_capacity_override integer;
  v_saved integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if p_default_uses is null or p_default_uses < 1 or p_default_uses > 20 then
    raise exception 'invalid_resource_uses';
  end if;

  if p_resource_settings is null or jsonb_typeof(p_resource_settings) <> 'array' then
    raise exception 'invalid_resource_settings';
  end if;

  if jsonb_array_length(p_resource_settings) > 250 then
    raise exception 'too_many_resource_settings';
  end if;

  select *
    into v_session
  from public.class_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_session.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if not v_session.requires_resource then
    raise exception 'session_does_not_require_resource';
  end if;

  if v_session.space_id is null then
    raise exception 'resource_session_requires_space';
  end if;

  if exists (
    select 1
    from (
      select a.resource_id, count(*)::integer as used_count
      from public.reservation_resource_assignments a
      where a.session_id = v_session.id
        and a.released_at is null
      group by a.resource_id
    ) assigned
    left join jsonb_array_elements(p_resource_settings) item
      on nullif(item->>'resource_id', '')::uuid = assigned.resource_id
    where item is null
       or coalesce((item->>'enabled')::boolean, false) = false
       or assigned.used_count >
          coalesce(
            nullif(item->>'capacity_override', '')::integer,
            p_default_uses
          )
  ) then
    raise exception 'active_assignments';
  end if;

  update public.class_sessions
  set
    resource_uses_per_item = p_default_uses,
    resource_config_customized = true,
    resource_config_needs_review = false
  where id = v_session.id;

  update public.session_resources sr
  set enabled = false,
      capacity_override = null,
      updated_at = now()
  where sr.session_id = v_session.id
    and not exists (
      select 1
      from jsonb_array_elements(p_resource_settings) item
      where nullif(item->>'resource_id', '')::uuid = sr.resource_id
    );

  for v_item in
    select value
    from jsonb_array_elements(p_resource_settings)
  loop
    v_resource_id := nullif(v_item->>'resource_id', '')::uuid;
    v_enabled := coalesce((v_item->>'enabled')::boolean, false);
    v_capacity_override := case
      when nullif(v_item->>'capacity_override', '') is null then null
      else (v_item->>'capacity_override')::integer
    end;

    if v_resource_id is null then
      raise exception 'invalid_resource_id';
    end if;

    if v_capacity_override is not null
      and (v_capacity_override < 1 or v_capacity_override > 20) then
      raise exception 'invalid_resource_capacity';
    end if;

    if not exists (
      select 1
      from public.resources r
      where r.id = v_resource_id
        and r.studio_id = v_session.studio_id
        and r.space_id = v_session.space_id
    ) then
      raise exception 'resource_not_in_session_space';
    end if;

    insert into public.session_resources (
      studio_id,
      session_id,
      resource_id,
      enabled,
      capacity_override
    )
    values (
      v_session.studio_id,
      v_session.id,
      v_resource_id,
      v_enabled,
      v_capacity_override
    )
    on conflict (session_id, resource_id)
    do update set
      enabled = excluded.enabled,
      capacity_override = excluded.capacity_override,
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'default_uses', p_default_uses,
    'resource_count', v_saved,
    'customized', true
  );
end;
$$;

revoke all on function public.admin_save_session_resources(uuid, integer, jsonb)
from public, anon;
grant execute on function public.admin_save_session_resources(uuid, integer, jsonb)
to authenticated;

create or replace function public.admin_restore_session_resource_defaults(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select studio_id
    into v_studio_id
  from public.class_sessions
  where id = p_session_id;

  if v_studio_id is null then
    raise exception 'session_not_found';
  end if;

  if not private.has_capability(v_studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  perform private.recursos01_apply_template_defaults_to_session(p_session_id, true);

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'customized', false
  );
end;
$$;

revoke all on function public.admin_restore_session_resource_defaults(uuid)
from public, anon;
grant execute on function public.admin_restore_session_resource_defaults(uuid)
to authenticated;

create or replace function public.materialize_recurring_schedule(
  p_schedule_id uuid,
  p_through date default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.recurring_schedules%rowtype;
  t public.class_templates%rowtype;
  tz text;
  d date;
  last_date date;
  starts_at_value timestamptz;
  inserted_count integer := 0;
begin
  select * into s
  from public.recurring_schedules
  where id = p_schedule_id;

  if not found or not s.active then
    return 0;
  end if;

  if not private.has_capability(s.studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into t
  from public.class_templates
  where id = s.template_id
    and studio_id = s.studio_id;

  if not found then
    raise exception 'template_not_found';
  end if;

  select timezone into tz
  from public.studios
  where id = s.studio_id;

  last_date := least(
    coalesce(p_through, current_date + 84),
    coalesce(s.ends_on, 'infinity'::date)
  );
  d := greatest(s.starts_on, current_date - 1);

  while d <= last_date loop
    if extract(dow from d)::smallint = s.weekday then
      starts_at_value :=
        (d + s.local_time) at time zone coalesce(tz, 'America/Mexico_City');

      if not exists (
        select 1
        from public.class_sessions cs
        where cs.recurring_schedule_id = s.id
          and cs.starts_at = starts_at_value
      ) then
        if not public.admin_session_has_conflict(
          s.studio_id,
          starts_at_value,
          starts_at_value + make_interval(mins => t.duration_minutes),
          s.instructor_id,
          s.space_id,
          null
        ) then
          insert into public.class_sessions (
            studio_id,
            template_id,
            instructor_id,
            space_id,
            starts_at,
            ends_at,
            capacity,
            notes,
            recurring_schedule_id,
            requires_resource,
            resource_uses_per_item
          )
          values (
            s.studio_id,
            s.template_id,
            s.instructor_id,
            s.space_id,
            starts_at_value,
            starts_at_value + make_interval(mins => t.duration_minutes),
            s.capacity,
            s.notes,
            s.id,
            t.requires_resource,
            t.resource_uses_per_item
          );

          inserted_count := inserted_count + 1;
        end if;
      end if;
    end if;

    d := d + 1;
  end loop;

  return inserted_count;
end;
$$;

grant execute on function public.materialize_recurring_schedule(uuid, date)
to authenticated;

comment on function public.admin_save_activity_v2(
  uuid, uuid, text, text, integer, integer, text, boolean, integer, text,
  uuid, uuid, date, date, jsonb, integer, jsonb
) is 'ACTIVIDADES · Recursos: saves activity-level resource defaults and synchronizes future inherited sessions safely.';

comment on function public.admin_restore_session_resource_defaults(uuid) is
  'Restores a scheduled session to the current activity resource defaults when existing assignments remain valid.';
