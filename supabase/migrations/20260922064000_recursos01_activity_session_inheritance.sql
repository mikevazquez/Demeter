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
            1
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

comment on function public.materialize_recurring_schedule(uuid, date) is
  'Materializes recurring class sessions and snapshots activity resource requirements at creation time.';
