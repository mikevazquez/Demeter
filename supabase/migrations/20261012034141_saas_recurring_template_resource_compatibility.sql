-- Keep recurring sessions compatible with templates that no longer expose resource_uses_per_item.
-- Missing template defaults mean one use per resource; normal days must set a non-null exception flag.
CREATE OR REPLACE FUNCTION public.materialize_recurring_schedule(p_schedule_id uuid, p_through date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  s public.recurring_schedules%rowtype;
  t public.class_templates%rowtype;
  tz text;
  d date;
  last_date date;
  starts_at_value timestamptz;
  inserted_count integer := 0;
  v_override_id uuid;
  v_operation_mode text;
  v_special_schedule_ids uuid[];
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
      v_override_id := null;
      v_operation_mode := null;
      v_special_schedule_ids := '{}'::uuid[];

      select o.id, o.operation_mode, o.special_recurring_schedule_ids
        into v_override_id, v_operation_mode, v_special_schedule_ids
      from public.studio_holiday_overrides o
      where o.studio_id = s.studio_id
        and o.holiday_date = d
      limit 1;

      if v_operation_mode = 'closed'
         or (
           v_operation_mode = 'special'
           and not (s.id = any(coalesce(v_special_schedule_ids, '{}'::uuid[])))
         ) then
        d := d + 1;
        continue;
      end if;

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
            resource_uses_per_item,
            holiday_override_id,
            is_schedule_exception
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
            coalesce((to_jsonb(t)->>'resource_uses_per_item')::integer, 1),
            case when v_operation_mode = 'special' then v_override_id else null end,
            coalesce(v_operation_mode = 'special', false)
          );

          inserted_count := inserted_count + 1;
        end if;
      end if;
    end if;

    d := d + 1;
  end loop;

  return inserted_count;
end;
$function$
;
