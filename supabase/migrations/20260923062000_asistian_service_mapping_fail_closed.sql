-- ASISTIAN-INBOUND-05
-- Once Asistian supplies a native service ID, require an explicit mapping for booking/reschedule.
-- Legacy name matching remains only for payloads that do not contain service.id.

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
  if v_service_id is not null then
    select exists (
      select 1
      from public.asistian_service_mappings m
      join public.class_templates ct
        on ct.id = m.class_template_id
       and ct.studio_id = m.studio_id
      where m.studio_id = target_studio_id
        and m.asistian_service_id = v_service_id
        and m.active
        and ct.active
    ) into v_mapping_used;
  end if;

  if v_service_id is not null and not v_mapping_used then
    v_resolved_service_name := '__asistian_unmapped_service__:' || v_service_id;
  else
    v_resolved_service_name := private.asistian_mapped_service_name(
      target_studio_id,
      v_service_id,
      v_external_service_name
    );
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

  if v_service_id is not null
     and not v_mapping_used
     and coalesce((v_result->>'ok')::boolean, false) then
    update public.asistian_booking_links
    set sync_status = 'requires_attention',
        last_error_code = 'service_mapping_missing'
    where studio_id = target_studio_id
      and asistian_booking_id = trim(coalesce(target_booking_id, ''));

    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
      'sync_status', 'requires_attention',
      'reason_code', 'service_mapping_missing',
      'service_mapping_used', false,
      'asistian_service_id', v_service_id
    );
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
  v_event text := lower(trim(coalesce(target_event_name, '')));
  v_service_id text := nullif(trim(coalesce(target_service_id, '')), '');
  v_external_service_name text := nullif(trim(coalesce(target_service_name, '')), '');
  v_resolved_service_name text;
  v_mapping_used boolean := false;
  v_result jsonb;
begin
  if v_service_id is not null then
    select exists (
      select 1
      from public.asistian_service_mappings m
      join public.class_templates ct
        on ct.id = m.class_template_id
       and ct.studio_id = m.studio_id
      where m.studio_id = target_studio_id
        and m.asistian_service_id = v_service_id
        and m.active
        and ct.active
    ) into v_mapping_used;
  end if;

  if v_event = 'booking_rescheduled'
     and v_service_id is not null
     and not v_mapping_used then
    v_resolved_service_name := '__asistian_unmapped_service__:' || v_service_id;
  else
    v_resolved_service_name := private.asistian_mapped_service_name(
      target_studio_id,
      v_service_id,
      v_external_service_name
    );
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

  if v_event = 'booking_rescheduled'
     and v_service_id is not null
     and not v_mapping_used
     and coalesce((v_result->>'ok')::boolean, false) then
    update public.asistian_booking_links
    set sync_status = 'requires_attention',
        last_error_code = 'service_mapping_missing'
    where studio_id = target_studio_id
      and asistian_booking_id = trim(coalesce(target_booking_id, ''));

    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
      'sync_status', 'requires_attention',
      'reason_code', 'service_mapping_missing',
      'service_mapping_used', false,
      'asistian_service_id', v_service_id
    );
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
