create or replace function public.admin_save_activity(
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
  p_schedules jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
  v_item jsonb;
  v_schedule public.recurring_schedules%rowtype;
  v_schedule_id uuid;
  v_weekday smallint;
  v_local_time time without time zone;
  v_incoming_ids uuid[] := array[]::uuid[];
  v_changed boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not private.has_capability(p_studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if btrim(coalesce(p_name, '')) = ''
    or char_length(btrim(p_name)) > 80
    or p_duration_minutes not between 15 and 360
    or p_capacity < 1
    or coalesce(p_color_hex, '') !~ '^#[0-9A-Fa-f]{6}$'
    or (p_description is not null and char_length(p_description) > 500)
    or (p_individual_purchase_notes is not null and char_length(p_individual_purchase_notes) > 300)
    or (p_drop_in_price_minor is not null and p_drop_in_price_minor <= 0)
    or p_starts_on is null
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or p_schedules is null
    or jsonb_typeof(p_schedules) <> 'array'
    or jsonb_array_length(p_schedules) = 0
    or jsonb_array_length(p_schedules) > 100
  then
    raise exception 'invalid_activity';
  end if;

  if p_requires_resource and p_default_space_id is null then
    raise exception 'resource_activity_requires_space';
  end if;

  if p_default_instructor_id is not null and not exists (
    select 1
    from public.instructors i
    where i.id = p_default_instructor_id
      and i.studio_id = p_studio_id
      and i.status = 'active'
  ) then
    raise exception 'invalid_instructor';
  end if;

  if p_default_space_id is not null then
    if not exists (
      select 1
      from public.spaces s
      where s.id = p_default_space_id
        and s.studio_id = p_studio_id
        and s.active
    ) then
      raise exception 'invalid_space';
    end if;

    if exists (
      select 1
      from public.spaces s
      where s.id = p_default_space_id
        and s.studio_id = p_studio_id
        and s.capacity is not null
        and p_capacity > s.capacity
    ) then
      raise exception 'space_capacity';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_schedules)
  loop
    v_weekday := nullif(v_item->>'weekday', '')::smallint;
    v_local_time := nullif(v_item->>'startTime', '')::time;
    v_schedule_id := nullif(v_item->>'id', '')::uuid;

    if v_weekday is null or v_weekday < 0 or v_weekday > 6 or v_local_time is null then
      raise exception 'invalid_schedule';
    end if;

    if v_schedule_id is not null then
      if v_schedule_id = any(v_incoming_ids) then
        raise exception 'duplicate_schedule';
      end if;
      v_incoming_ids := array_append(v_incoming_ids, v_schedule_id);
    end if;
  end loop;

  if p_activity_id is null then
    insert into public.class_templates (
      studio_id,
      discipline_id,
      name,
      description,
      duration_minutes,
      capacity,
      active,
      credit_cost,
      drop_in_price_minor,
      individual_purchase_notes,
      color_hex,
      requires_resource
    )
    values (
      p_studio_id,
      null,
      btrim(p_name),
      nullif(btrim(coalesce(p_description, '')), ''),
      p_duration_minutes,
      p_capacity,
      true,
      1,
      p_drop_in_price_minor,
      nullif(btrim(coalesce(p_individual_purchase_notes, '')), ''),
      upper(p_color_hex),
      coalesce(p_requires_resource, false)
    )
    returning id into v_activity_id;
  else
    select ct.id into v_activity_id
    from public.class_templates ct
    where ct.id = p_activity_id
      and ct.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'activity_not_found';
    end if;

    update public.class_templates
    set
      name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      duration_minutes = p_duration_minutes,
      capacity = p_capacity,
      color_hex = upper(p_color_hex),
      requires_resource = coalesce(p_requires_resource, false),
      credit_cost = 1,
      drop_in_price_minor = p_drop_in_price_minor,
      individual_purchase_notes = nullif(btrim(coalesce(p_individual_purchase_notes, '')), '')
    where id = v_activity_id
      and studio_id = p_studio_id;
  end if;

  if p_activity_id is not null then
    for v_schedule in
      select *
      from public.recurring_schedules rs
      where rs.studio_id = p_studio_id
        and rs.template_id = v_activity_id
        and rs.active
    loop
      if not (v_schedule.id = any(v_incoming_ids)) then
        update public.class_sessions cs
        set
          recurring_schedule_id = null,
          is_schedule_exception = true
        where cs.studio_id = p_studio_id
          and cs.recurring_schedule_id = v_schedule.id
          and cs.starts_at >= now()
          and exists (
            select 1 from public.reservations r where r.session_id = cs.id
          );

        delete from public.class_sessions cs
        where cs.studio_id = p_studio_id
          and cs.recurring_schedule_id = v_schedule.id
          and cs.starts_at >= now()
          and not exists (
            select 1 from public.reservations r where r.session_id = cs.id
          );

        update public.recurring_schedules
        set active = false
        where id = v_schedule.id
          and studio_id = p_studio_id;
      end if;
    end loop;
  end if;

  for v_item in select value from jsonb_array_elements(p_schedules)
  loop
    v_schedule_id := nullif(v_item->>'id', '')::uuid;
    v_weekday := (v_item->>'weekday')::smallint;
    v_local_time := (v_item->>'startTime')::time;

    if v_schedule_id is null then
      insert into public.recurring_schedules (
        studio_id,
        template_id,
        instructor_id,
        space_id,
        weekday,
        local_time,
        duration_minutes,
        capacity,
        starts_on,
        ends_on,
        active
      )
      values (
        p_studio_id,
        v_activity_id,
        p_default_instructor_id,
        p_default_space_id,
        v_weekday,
        v_local_time,
        p_duration_minutes,
        p_capacity,
        p_starts_on,
        p_ends_on,
        true
      )
      returning id into v_schedule_id;

      perform public.materialize_recurring_schedule(v_schedule_id, null);
    else
      select * into v_schedule
      from public.recurring_schedules rs
      where rs.id = v_schedule_id
        and rs.studio_id = p_studio_id
        and rs.template_id = v_activity_id
      for update;

      if not found then
        raise exception 'schedule_not_found';
      end if;

      v_changed :=
        v_schedule.instructor_id is distinct from p_default_instructor_id
        or v_schedule.space_id is distinct from p_default_space_id
        or v_schedule.weekday is distinct from v_weekday
        or v_schedule.local_time is distinct from v_local_time
        or coalesce(v_schedule.duration_minutes, p_duration_minutes) is distinct from p_duration_minutes
        or v_schedule.capacity is distinct from p_capacity
        or v_schedule.starts_on is distinct from p_starts_on
        or v_schedule.ends_on is distinct from p_ends_on
        or not v_schedule.active;

      if v_changed then
        update public.class_sessions cs
        set
          recurring_schedule_id = null,
          is_schedule_exception = true
        where cs.studio_id = p_studio_id
          and cs.recurring_schedule_id = v_schedule_id
          and cs.starts_at >= now()
          and exists (
            select 1 from public.reservations r where r.session_id = cs.id
          );

        delete from public.class_sessions cs
        where cs.studio_id = p_studio_id
          and cs.recurring_schedule_id = v_schedule_id
          and cs.starts_at >= now()
          and not exists (
            select 1 from public.reservations r where r.session_id = cs.id
          );

        update public.recurring_schedules
        set
          instructor_id = p_default_instructor_id,
          space_id = p_default_space_id,
          weekday = v_weekday,
          local_time = v_local_time,
          duration_minutes = p_duration_minutes,
          capacity = p_capacity,
          starts_on = p_starts_on,
          ends_on = p_ends_on,
          active = true,
          updated_at = now()
        where id = v_schedule_id
          and studio_id = p_studio_id;

        perform public.materialize_recurring_schedule(v_schedule_id, null);
      end if;
    end if;
  end loop;

  return v_activity_id;
end;
$$;

revoke all on function public.admin_save_activity(
  uuid, uuid, text, text, integer, integer, text, boolean, integer, text, uuid, uuid, date, date, jsonb
) from public, anon;

grant execute on function public.admin_save_activity(
  uuid, uuid, text, text, integer, integer, text, boolean, integer, text, uuid, uuid, date, date, jsonb
) to authenticated;

comment on function public.admin_save_activity(
  uuid, uuid, text, text, integer, integer, text, boolean, integer, text, uuid, uuid, date, date, jsonb
) is 'ACTIVIDADES-01 atomic save for activity + recurring schedules; preserves booked future sessions as exceptions.';
