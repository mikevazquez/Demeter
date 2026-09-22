-- ACTIVIDADES-01 · restore the approved standalone activity domain.
-- Existing activities keep their discipline link; new activities no longer require a discipline selection.

alter table public.class_templates
  add column if not exists description text,
  add column if not exists individual_purchase_notes text;

alter table public.class_templates
  alter column discipline_id drop not null;

alter table public.class_templates
  drop constraint if exists class_templates_description_length,
  add constraint class_templates_description_length
    check (description is null or char_length(description) <= 500);

alter table public.class_templates
  drop constraint if exists class_templates_individual_purchase_notes_length,
  add constraint class_templates_individual_purchase_notes_length
    check (individual_purchase_notes is null or char_length(individual_purchase_notes) <= 300);

alter table public.recurring_schedules
  add column if not exists duration_minutes integer;

alter table public.recurring_schedules
  drop constraint if exists recurring_schedules_duration_minutes_check,
  add constraint recurring_schedules_duration_minutes_check
    check (
      duration_minutes is null
      or (duration_minutes >= 15 and duration_minutes <= 360)
    );

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
  duration_value integer;
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

  if t.requires_resource and s.space_id is null then
    raise exception 'resource_activity_requires_space';
  end if;

  duration_value := coalesce(s.duration_minutes, t.duration_minutes);

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
          starts_at_value + make_interval(mins => duration_value),
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
            starts_at_value + make_interval(mins => duration_value),
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

comment on column public.class_templates.description is
  'ACTIVIDADES-01 A01 description shown in activity setup and student-facing context when used.';

comment on column public.class_templates.individual_purchase_notes is
  'ACTIVIDADES-01 A03 optional notes for individual purchase.';

comment on column public.recurring_schedules.duration_minutes is
  'ACTIVIDADES-01 A02 optional duration override derived from each start/end slot.';

comment on function public.materialize_recurring_schedule(uuid, date) is
  'Materializes recurring sessions using the schedule duration override when present and snapshots resource requirements.';
