-- ACTIVIDADES-02 · Avoid PostgREST ambiguity between the legacy 15-argument
-- activity save function and the current minimum-aware 19-argument function.
-- The legacy implementation remains available only as a private helper.

alter function public.admin_save_activity(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb
) set schema private;

alter function private.admin_save_activity(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb
) rename to admin_save_activity_core;

revoke all on function private.admin_save_activity_core(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb
) from public, anon, authenticated, service_role;

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
  p_schedules jsonb,
  p_minimum_reservations_enabled boolean,
  p_minimum_reservations integer,
  p_minimum_review_minutes_before integer,
  p_allow_minimum_reservation_override boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not private.has_capability(p_studio_id, 'schedule.write') then
    raise exception 'forbidden';
  end if;

  if coalesce(p_minimum_reservations_enabled, false) and (
    p_minimum_reservations is null
    or p_minimum_reservations < 1
    or p_minimum_reservations > p_capacity
    or p_minimum_review_minutes_before is null
    or p_minimum_review_minutes_before < 15
    or p_minimum_review_minutes_before > 10080
  ) then
    raise exception 'invalid_minimum_reservation_rule';
  end if;

  v_activity_id := private.admin_save_activity_core(
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
  );

  update public.class_templates
  set minimum_reservations_enabled = coalesce(p_minimum_reservations_enabled, false),
      minimum_reservations = greatest(coalesce(p_minimum_reservations, 2), 1),
      minimum_review_minutes_before = greatest(
        coalesce(p_minimum_review_minutes_before, 120),
        15
      ),
      allow_minimum_reservation_override = coalesce(
        p_allow_minimum_reservation_override,
        true
      )
  where id = v_activity_id
    and studio_id = p_studio_id;

  update public.class_sessions cs
  set minimum_reservations_enabled = coalesce(p_minimum_reservations_enabled, false),
      minimum_reservations = greatest(coalesce(p_minimum_reservations, 2), 1),
      minimum_review_minutes_before = greatest(
        coalesce(p_minimum_review_minutes_before, 120),
        15
      ),
      minimum_override_allowed = coalesce(
        p_allow_minimum_reservation_override,
        true
      )
  where cs.studio_id = p_studio_id
    and cs.template_id = v_activity_id
    and cs.status = 'scheduled'
    and cs.starts_at > clock_timestamp()
    and cs.minimum_review_status not in ('met','cancelled');

  perform private.process_due_minimum_reservation_sessions(p_studio_id, null);

  return v_activity_id;
end;
$$;

revoke all on function public.admin_save_activity(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb,
  boolean,integer,integer,boolean
) from public, anon;
grant execute on function public.admin_save_activity(
  uuid,uuid,text,text,integer,integer,text,boolean,integer,text,uuid,uuid,date,date,jsonb,
  boolean,integer,integer,boolean
) to authenticated;
