-- SF-246 event coverage + producer isolation.
-- Cancellation affects attendance metrics and must trigger reevaluation.
-- Emission is best-effort so Rewards can never roll back the source operation.

create or replace function private.reward_try_emit_domain_event(
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
security definer
set search_path = ''
as $reward_emit$
begin
  begin
    return public.emit_domain_event(
      p_studio_id,
      p_event_type,
      p_source_entity_type,
      p_source_entity_id,
      p_deduplication_key,
      p_occurred_at,
      p_actor_user_id,
      p_payload,
      p_correlation_id,
      p_causation_event_id,
      p_event_id
    );
  exception when others then
    return null;
  end;
end;
$reward_emit$;

revoke all on function private.reward_try_emit_domain_event(
  uuid,text,text,uuid,text,timestamptz,uuid,jsonb,uuid,uuid,uuid
) from public, anon, authenticated, service_role;

create or replace function private.reward_sync_rule_event_bindings(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_version public.reward_rule_versions%rowtype;
  v_condition jsonb;
  v_metric text;
begin
  select * into v_rule
  from public.reward_rules
  where id = p_rule_id;

  if not found or v_rule.status <> 'active' then
    return;
  end if;

  select * into v_version
  from public.reward_rule_versions
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number;

  if not found then
    return;
  end if;

  delete from public.reward_rule_event_bindings
  where rule_id = v_rule.id
    and version_number = v_rule.current_version_number;

  for v_condition in
    select value
    from jsonb_array_elements(coalesce(v_version.condition_definition->'conditions', '[]'::jsonb))
  loop
    v_metric := trim(coalesce(v_condition->>'metric', ''));

    if v_metric like 'attendance.%' then
      insert into public.reward_rule_event_bindings(
        studio_id, rule_id, version_number, event_type, metric_key
      ) values
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'attendance.finalized', v_metric),
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'attendance.corrected', v_metric),
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'attendance.cancelled', v_metric)
      on conflict (rule_id, version_number, event_type, metric_key) do nothing;
    elsif v_metric like 'loyalty.%' then
      insert into public.reward_rule_event_bindings(
        studio_id, rule_id, version_number, event_type, metric_key
      ) values
        (v_rule.studio_id, v_rule.id, v_rule.current_version_number, 'loyalty.changed', v_metric)
      on conflict (rule_id, version_number, event_type, metric_key) do nothing;
    end if;
  end loop;
end;
$$;


revoke all on function private.reward_sync_rule_event_bindings(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_emit_attendance_finalized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation record;
begin
  if old.status is distinct from new.status and new.status = 'completed' then
    for v_reservation in
      select r.id, r.student_id, r.status
      from public.reservations r
      where r.session_id = new.id
        and r.studio_id = new.studio_id
        and r.student_id is not null
        and r.status in ('attended', 'no_show')
    loop
      perform private.reward_try_emit_domain_event(
        new.studio_id,
        'attendance.finalized',
        'reservation',
        v_reservation.id,
        'rewards:attendance:finalized:' || v_reservation.id::text,
        clock_timestamp(),
        (select auth.uid()),
        jsonb_build_object(
          'student_id', v_reservation.student_id,
          'reservation_id', v_reservation.id,
          'session_id', new.id,
          'attendance_status', v_reservation.status
        ),
        null,
        null,
        null
      );
    end loop;
  end if;
  return new;
end;
$$;


revoke all on function private.reward_emit_attendance_finalized()
from public, anon, authenticated, service_role;

create or replace function private.reward_emit_attendance_corrected_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_status public.session_status;
  v_correction_id uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select cs.status into v_session_status
  from public.class_sessions cs
  where cs.id = new.session_id
    and cs.studio_id = new.studio_id;

  if v_session_status <> 'completed' or new.student_id is null then
    return new;
  end if;

  select ac.id into v_correction_id
  from public.attendance_corrections ac
  where ac.studio_id = new.studio_id
    and ac.reservation_id = new.id
    and ac.from_status = old.status
    and ac.to_status = new.status
  order by ac.created_at desc, ac.id desc
  limit 1;

  if v_correction_id is null then
    return new;
  end if;

  perform private.reward_try_emit_domain_event(
    new.studio_id,
    'attendance.corrected',
    'reservation',
    new.id,
    'rewards:attendance:corrected:' || v_correction_id::text,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', new.student_id,
      'reservation_id', new.id,
      'session_id', new.session_id,
      'from_status', old.status,
      'to_status', new.status,
      'correction_id', v_correction_id
    ),
    null,
    null,
    null
  );

  return new;
end;
$$;


revoke all on function private.reward_emit_attendance_corrected_from_reservation()
from public, anon, authenticated, service_role;

create or replace function private.reward_emit_loyalty_acquisition_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if new.student_id is null then return new; end if;

  v_hash := md5(to_jsonb(new)::text);
  perform private.reward_try_emit_domain_event(
    new.studio_id,
    'loyalty.changed',
    'product_acquisition',
    new.id,
    'rewards:loyalty:acquisition:' || new.id::text || ':' || v_hash,
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', new.student_id,
      'acquisition_id', new.id,
      'status', new.status,
      'starts_on', new.starts_on,
      'expires_on', new.expires_on,
      'access_blocked', new.access_blocked,
      'refunded_at', new.refunded_at
    ),
    null,
    null,
    null
  );
  return new;
end;
$$;


revoke all on function private.reward_emit_loyalty_acquisition_changed()
from public, anon, authenticated, service_role;

create or replace function private.reward_emit_loyalty_payment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  select s.student_id into v_student_id
  from public.sales s
  where s.id = new.sale_id
    and s.studio_id = new.studio_id;

  if v_student_id is null then return new; end if;

  perform private.reward_try_emit_domain_event(
    new.studio_id,
    'loyalty.changed',
    'payment',
    new.id,
    'rewards:loyalty:payment:' || new.id::text || ':' || md5(to_jsonb(new)::text),
    clock_timestamp(),
    (select auth.uid()),
    jsonb_build_object(
      'student_id', v_student_id,
      'payment_id', new.id,
      'sale_id', new.sale_id,
      'kind', new.kind,
      'amount_minor', new.amount_minor,
      'effective_on', new.effective_on
    ),
    null,
    null,
    null
  );
  return new;
end;
$$;


revoke all on function private.reward_emit_loyalty_payment_changed()
from public, anon, authenticated, service_role;

create or replace function private.reward_emit_attendance_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
     and new.student_id is not null
     and new.status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio') then
    perform private.reward_try_emit_domain_event(
      new.studio_id,
      'attendance.cancelled',
      'reservation',
      new.id,
      'rewards:attendance:cancelled:' || new.id::text || ':' || new.status::text,
      clock_timestamp(),
      (select auth.uid()),
      jsonb_build_object(
        'student_id', new.student_id,
        'reservation_id', new.id,
        'session_id', new.session_id,
        'from_status', old.status,
        'to_status', new.status
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function private.reward_emit_attendance_cancelled()
from public, anon, authenticated, service_role;

drop trigger if exists reward_emit_attendance_cancelled on public.reservations;
create trigger reward_emit_attendance_cancelled
after update of status on public.reservations
for each row execute function private.reward_emit_attendance_cancelled();

do $$
declare
  v_rule record;
begin
  for v_rule in
    select id from public.reward_rules where status = 'active'
  loop
    perform private.reward_sync_rule_event_bindings(v_rule.id);
  end loop;
end
$$;
