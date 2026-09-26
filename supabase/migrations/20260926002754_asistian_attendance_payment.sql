alter table public.payments
  add column if not exists reservation_id uuid references public.reservations(id) on delete restrict;

create unique index if not exists payments_reservation_direct_payment_unique
  on public.payments(reservation_id)
  where reservation_id is not null
    and kind = 'payment';

alter table public.product_templates
  add column if not exists source_class_template_id uuid references public.class_templates(id) on delete set null;

create unique index if not exists product_templates_direct_class_source_price_unique
  on public.product_templates(studio_id, source_class_template_id, price_minor)
  where source_class_template_id is not null
    and product_type = 'single_class'::public.product_type;

create or replace function private.enforce_asistian_payment_before_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'attended'
     and coalesce(new.commercial_status::text, '') = 'payment_pending'
     and exists (
       select 1
       from public.asistian_booking_links abl
       where abl.reservation_id = new.id
         and abl.studio_id = new.studio_id
     ) then
    raise exception 'asistian_payment_required';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_asistian_payment_before_attendance()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_asistian_payment_before_attendance
  on public.reservations;

create trigger enforce_asistian_payment_before_attendance
before insert or update of status, commercial_status
on public.reservations
for each row
execute function private.enforce_asistian_payment_before_attendance();

create or replace function public.record_asistian_class_payment_and_attendance(
  target_reservation_id uuid,
  payment_method text,
  payment_reference text default null,
  payment_amount_minor integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_product public.product_templates%rowtype;
  v_existing_payment public.payments%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_sale_line_id uuid;
  v_acquisition_id uuid;
  v_amount integer;
  v_method text := lower(trim(coalesce(payment_method, '')));
  v_reference text := nullif(trim(coalesce(payment_reference, '')), '');
  v_timezone text;
  v_currency text;
  v_class_date date;
  v_folio text;
  v_pending_event_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if target_reservation_id is null then
    raise exception 'reservation_required';
  end if;

  if v_method not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'payment_method_required';
  end if;

  select *
    into v_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found';
  end if;

  if not private.has_capability(v_reservation.studio_id, 'attendance.write') then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.asistian_booking_links abl
    where abl.reservation_id = v_reservation.id
      and abl.studio_id = v_reservation.studio_id
  ) then
    raise exception 'reservation_not_asistian';
  end if;

  select *
    into v_existing_payment
  from public.payments p
  where p.reservation_id = v_reservation.id
    and p.kind = 'payment'
  order by p.created_at
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'reservation_id', v_reservation.id,
      'sale_id', v_existing_payment.sale_id,
      'payment_id', v_existing_payment.id,
      'status', v_reservation.status::text,
      'commercial_status', coalesce(v_reservation.commercial_status::text, 'paid')
    );
  end if;

  if coalesce(v_reservation.commercial_status::text, '') <> 'payment_pending' then
    raise exception 'payment_not_pending';
  end if;

  if v_reservation.status not in ('reserved', 'no_show') then
    raise exception 'invalid_attendance_state';
  end if;

  select *
    into v_session
  from public.class_sessions cs
  where cs.id = v_reservation.session_id
    and cs.studio_id = v_reservation.studio_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.status <> 'scheduled' then
    raise exception 'session_not_open';
  end if;

  if now() < v_session.starts_at then
    raise exception 'session_not_started';
  end if;

  if now() >= v_session.ends_at then
    raise exception 'session_ended';
  end if;

  if not private.can_manage_attendance_session(v_reservation.studio_id, v_session.id) then
    raise exception 'forbidden';
  end if;

  select *
    into v_template
  from public.class_templates ct
  where ct.id = v_session.template_id
    and ct.studio_id = v_reservation.studio_id;

  if not found then
    raise exception 'activity_not_found';
  end if;

  if coalesce(v_template.drop_in_price_minor, 0) > 0 then
    v_amount := v_template.drop_in_price_minor;
  else
    if not private.has_capability(v_reservation.studio_id, 'sales.write') then
      raise exception 'class_price_required';
    end if;
    v_amount := payment_amount_minor;
  end if;

  if coalesce(v_amount, 0) <= 0 then
    raise exception 'class_price_required';
  end if;

  select coalesce(s.timezone, 'America/Mexico_City'),
         coalesce(s.currency, 'MXN')
    into v_timezone, v_currency
  from public.studios s
  where s.id = v_reservation.studio_id;

  v_class_date := (v_session.starts_at at time zone v_timezone)::date;
  v_folio := 'AS-' || to_char(v_class_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_sale_id::text, '-', ''), 1, 12));

  select *
    into v_product
  from public.product_templates pt
  where pt.studio_id = v_reservation.studio_id
    and pt.source_class_template_id = v_template.id
    and pt.product_type = 'single_class'::public.product_type
    and pt.price_minor = v_amount
  order by pt.created_at
  limit 1
  for update;

  if not found then
    insert into public.product_templates(
      studio_id,
      name,
      description,
      product_type,
      price_minor,
      currency,
      credit_limit,
      validity_days,
      unlimited,
      active,
      package_term,
      online_purchasable,
      source_class_template_id
    )
    values(
      v_reservation.studio_id,
      'Clase suelta · ' || v_template.name,
      'Producto interno para cobro de asistencia de clase individual',
      'single_class'::public.product_type,
      v_amount,
      upper(v_currency),
      1,
      1,
      false,
      false,
      null,
      false,
      v_template.id
    )
    returning * into v_product;
  end if;

  if v_template.discipline_id is not null then
    insert into public.product_template_disciplines(
      studio_id,
      product_template_id,
      discipline_id
    )
    values(
      v_reservation.studio_id,
      v_product.id,
      v_template.discipline_id
    )
    on conflict do nothing;
  end if;

  insert into public.sales(
    id,
    studio_id,
    student_id,
    folio,
    status,
    currency,
    total_minor,
    created_by
  )
  values(
    v_sale_id,
    v_reservation.studio_id,
    v_reservation.student_id,
    v_folio,
    'confirmed',
    upper(v_currency),
    v_amount,
    (select auth.uid())
  );

  insert into public.sale_lines(
    studio_id,
    sale_id,
    product_template_id,
    product_name,
    quantity,
    unit_price_minor,
    line_total_minor
  )
  values(
    v_reservation.studio_id,
    v_sale_id,
    v_product.id,
    'Clase suelta · ' || v_template.name,
    1,
    v_amount,
    v_amount
  )
  returning id into v_sale_line_id;

  insert into public.payments(
    studio_id,
    sale_id,
    sale_line_id,
    kind,
    amount_minor,
    method,
    reference,
    notes,
    created_by,
    effective_on,
    reservation_id
  )
  values(
    v_reservation.studio_id,
    v_sale_id,
    v_sale_line_id,
    'payment',
    v_amount,
    v_method,
    v_reference,
    'Cobro de clase pendiente proveniente de Asistian',
    (select auth.uid()),
    v_class_date,
    v_reservation.id
  )
  returning id into v_existing_payment.id;

  insert into public.product_acquisitions(
    studio_id,
    student_id,
    product_template_id,
    status,
    starts_on,
    expires_on,
    credit_limit,
    unlimited,
    sale_line_id,
    activation_mode,
    access_blocked,
    validity_days_snapshot
  )
  values(
    v_reservation.studio_id,
    v_reservation.student_id,
    v_product.id,
    'active',
    v_class_date,
    v_class_date + 1,
    1,
    false,
    v_sale_line_id,
    'fixed_date',
    false,
    1
  )
  returning id into v_acquisition_id;

  insert into public.credit_ledger(
    studio_id,
    acquisition_id,
    movement_type,
    quantity,
    note,
    created_by
  )
  values(
    v_reservation.studio_id,
    v_acquisition_id,
    'grant',
    1,
    'Clase individual cobrada al registrar asistencia',
    (select auth.uid())
  );

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
    v_reservation.studio_id,
    v_acquisition_id,
    'reserve',
    -1,
    v_reservation.id,
    'Crédito aplicado a la reserva cobrada al registrar asistencia',
    (select auth.uid())
  )
  on conflict (reservation_id, movement_type) do nothing;

  update public.reservations
  set acquisition_id = v_acquisition_id,
      credits_held = 1,
      commercial_status = 'paid'::public.reservation_commercial_status,
      status = 'attended',
      updated_at = clock_timestamp()
  where id = v_reservation.id;

  select e.event_id
    into v_pending_event_id
  from public.domain_events e
  where e.studio_id = v_reservation.studio_id
    and e.event_type = 'walkin.commercial_pending'
    and e.source_entity_type = 'reservation'
    and e.source_entity_id = v_reservation.id
    and not exists (
      select 1
      from public.domain_events resolved
      where resolved.studio_id = e.studio_id
        and resolved.event_type = 'walkin.commercial_resolved'
        and resolved.source_entity_type = 'reservation'
        and resolved.source_entity_id = e.source_entity_id
    )
  order by e.recorded_at
  limit 1;

  if v_pending_event_id is not null then
    perform public.emit_domain_event(
      p_studio_id => v_reservation.studio_id,
      p_event_type => 'walkin.commercial_resolved',
      p_source_entity_type => 'reservation',
      p_source_entity_id => v_reservation.id,
      p_deduplication_key => 'walkin.commercial_resolved:' || v_reservation.id::text,
      p_actor_user_id => (select auth.uid()),
      p_payload => jsonb_build_object(
        'student_id', v_reservation.student_id,
        'session_id', v_session.id,
        'pending_event_id', v_pending_event_id,
        'resolution_source', 'asistian_attendance_payment',
        'sale_id', v_sale_id,
        'payment_id', v_existing_payment.id,
        'acquisition_id', v_acquisition_id,
        'amount_minor', v_amount,
        'payment_method', v_method
      ),
      p_causation_event_id => v_pending_event_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'reservation_id', v_reservation.id,
    'sale_id', v_sale_id,
    'sale_line_id', v_sale_line_id,
    'payment_id', v_existing_payment.id,
    'acquisition_id', v_acquisition_id,
    'amount_minor', v_amount,
    'status', 'attended',
    'commercial_status', 'paid'
  );
end;
$function$;

revoke all on function public.record_asistian_class_payment_and_attendance(
  uuid, text, text, integer
) from public, anon;

grant execute on function public.record_asistian_class_payment_and_attendance(
  uuid, text, text, integer
) to authenticated;
