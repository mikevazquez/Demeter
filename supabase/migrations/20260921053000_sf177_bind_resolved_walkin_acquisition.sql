-- SF-177 follow-up · bind resolved walk-ins to the covering acquisition.

create or replace function private.sf177_resolve_walkin_commercial_pending_for_student(
  p_student_id uuid,
  p_resolution_source text,
  p_resolution_source_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending record;
  v_reservation public.reservations%rowtype;
  v_coverage jsonb;
  v_acquisition_id uuid;
  v_unlimited boolean;
  v_credit_cost integer;
  v_balance integer;
  v_resolved integer := 0;
begin
  if p_student_id is null then
    return 0;
  end if;

  for v_pending in
    select e.event_id,
           e.studio_id,
           e.source_entity_id as reservation_id,
           e.payload
    from public.domain_events e
    where e.event_type = 'walkin.commercial_pending'
      and e.source_entity_type = 'reservation'
      and e.payload->>'student_id' = p_student_id::text
      and not exists (
        select 1
        from public.domain_events resolved
        where resolved.studio_id = e.studio_id
          and resolved.event_type = 'walkin.commercial_resolved'
          and resolved.source_entity_type = 'reservation'
          and resolved.source_entity_id = e.source_entity_id
      )
    order by e.recorded_at
  loop
    select *
      into v_reservation
    from public.reservations
    where id = v_pending.reservation_id
    for update;

    if not found
       or v_reservation.status not in ('reserved', 'attended', 'no_show') then
      continue;
    end if;

    v_coverage := private.sf177_walkin_commercial_coverage(v_pending.reservation_id);

    if not coalesce((v_coverage->>'covered')::boolean, false) then
      continue;
    end if;

    v_acquisition_id := (v_coverage->>'acquisition_id')::uuid;
    v_unlimited := coalesce((v_coverage->>'unlimited')::boolean, false);
    v_credit_cost := greatest(coalesce((v_coverage->>'credit_cost')::integer, 1), 1);

    perform 1
    from public.product_acquisitions pa
    where pa.id = v_acquisition_id
      and pa.studio_id = v_pending.studio_id
      and pa.student_id = p_student_id
      and pa.status = 'active'
      and not pa.access_blocked
    for update;

    if not found then
      continue;
    end if;

    if v_reservation.acquisition_id is not null
       and v_reservation.acquisition_id <> v_acquisition_id then
      continue;
    end if;

    if not v_unlimited then
      select coalesce(sum(cl.quantity), 0)::integer
        into v_balance
      from public.credit_ledger cl
      where cl.acquisition_id = v_acquisition_id;

      if v_balance < v_credit_cost then
        continue;
      end if;
    end if;

    update public.reservations
    set acquisition_id = v_acquisition_id,
        credits_held = v_credit_cost,
        updated_at = now()
    where id = v_pending.reservation_id;

    if not v_unlimited then
      insert into public.credit_ledger(
        studio_id,
        acquisition_id,
        movement_type,
        quantity,
        reservation_id,
        note,
        created_by
      )
      values(
        v_pending.studio_id,
        v_acquisition_id,
        'reserve',
        -v_credit_cost,
        v_pending.reservation_id,
        format('%s crédito(s) reservados al regularizar walk-in', v_credit_cost),
        (select auth.uid())
      )
      on conflict (reservation_id, movement_type) do nothing;
    end if;

    perform public.emit_domain_event(
      p_studio_id => v_pending.studio_id,
      p_event_type => 'walkin.commercial_resolved',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_pending.reservation_id,
      p_deduplication_key => 'walkin.commercial_resolved:' || v_pending.reservation_id::text,
      p_actor_user_id => (select auth.uid()),
      p_payload => jsonb_build_object(
        'student_id', p_student_id,
        'session_id', v_pending.payload->>'session_id',
        'pending_event_id', v_pending.event_id,
        'resolution_source', nullif(trim(coalesce(p_resolution_source, '')), ''),
        'resolution_source_id', p_resolution_source_id,
        'acquisition_id', v_acquisition_id,
        'unlimited', v_unlimited,
        'available_credits', case when v_unlimited then null else v_balance - v_credit_cost end,
        'credit_cost', v_credit_cost
      ),
      p_causation_event_id => v_pending.event_id
    );

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

revoke all on function private.sf177_resolve_walkin_commercial_pending_for_student(uuid,text,uuid)
  from public, anon, authenticated;

-- Reconcile any already-resolved Sandbox/UAT rows created before this follow-up.
do $$
declare
  v_event record;
  v_credit_cost integer;
  v_unlimited boolean;
  v_acquisition_id uuid;
  v_balance integer;
begin
  for v_event in
    select e.source_entity_id as reservation_id,
           e.studio_id,
           e.payload
    from public.domain_events e
    join public.reservations r on r.id = e.source_entity_id
    where e.event_type = 'walkin.commercial_resolved'
      and e.source_entity_type = 'reservation'
      and r.acquisition_id is null
      and r.status in ('reserved', 'attended', 'no_show')
      and nullif(e.payload->>'acquisition_id','') is not null
  loop
    v_acquisition_id := (v_event.payload->>'acquisition_id')::uuid;
    v_unlimited := coalesce((v_event.payload->>'unlimited')::boolean, false);
    v_credit_cost := greatest(coalesce((v_event.payload->>'credit_cost')::integer, 1), 1);

    perform 1
    from public.product_acquisitions pa
    where pa.id = v_acquisition_id
      and pa.studio_id = v_event.studio_id
      and pa.status = 'active'
      and not pa.access_blocked
    for update;

    if not found then
      continue;
    end if;

    if not v_unlimited then
      select coalesce(sum(cl.quantity), 0)::integer
        into v_balance
      from public.credit_ledger cl
      where cl.acquisition_id = v_acquisition_id;

      if v_balance < v_credit_cost then
        continue;
      end if;
    end if;

    update public.reservations
    set acquisition_id = v_acquisition_id,
        credits_held = v_credit_cost,
        updated_at = now()
    where id = v_event.reservation_id
      and acquisition_id is null;

    if not v_unlimited then
      insert into public.credit_ledger(
        studio_id,
        acquisition_id,
        movement_type,
        quantity,
        reservation_id,
        note,
        created_by
      )
      values(
        v_event.studio_id,
        v_acquisition_id,
        'reserve',
        -v_credit_cost,
        v_event.reservation_id,
        format('%s crédito(s) reservados al reconciliar walk-in resuelto', v_credit_cost),
        null
      )
      on conflict (reservation_id, movement_type) do nothing;
    end if;
  end loop;
end;
$$;
