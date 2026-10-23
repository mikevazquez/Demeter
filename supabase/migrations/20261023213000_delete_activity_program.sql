-- TALLERES-LEGACY-DELETE: safe operational deletion for activity_programs.
-- The program and its generated records remain for audit/history. Operational surfaces stop exposing them.

-- Administrative correction for payments that were recorded but never actually received.
-- We keep the original payment row and add an offsetting accounting entry, while recording an
-- explicit audit row so the operation is distinguishable from a real cash refund.
create table if not exists private.payment_record_corrections (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  sale_id uuid not null references public.sales(id),
  original_payment_id uuid not null unique references public.payments(id),
  offset_payment_id uuid not null unique references public.payments(id),
  amount_minor integer not null check (amount_minor > 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  corrected_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table private.payment_record_corrections enable row level security;

create or replace function public.admin_correct_unreceived_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $
declare
  v_payment public.payments%rowtype;
  v_sale public.sales%rowtype;
  v_offset uuid;
  v_existing private.payment_record_corrections%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'correction_reason_required';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then raise exception 'payment_not_found'; end if;
  if v_payment.kind::text <> 'payment' then raise exception 'payment_not_correctable'; end if;

  select * into v_sale
  from public.sales
  where id = v_payment.sale_id
  for update;

  if not found then raise exception 'sale_not_found'; end if;
  if not private.has_capability(v_sale.studio_id, 'sales.write') then
    raise exception 'forbidden';
  end if;

  select * into v_existing
  from private.payment_record_corrections
  where original_payment_id = v_payment.id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'sale_id', v_existing.sale_id,
      'original_payment_id', v_existing.original_payment_id,
      'offset_payment_id', v_existing.offset_payment_id,
      'amount_minor', v_existing.amount_minor
    );
  end if;

  insert into public.payments(
    studio_id,
    sale_id,
    sale_line_id,
    reservation_id,
    kind,
    amount_minor,
    method,
    reference,
    notes,
    reason,
    created_by,
    effective_on
  ) values (
    v_payment.studio_id,
    v_payment.sale_id,
    v_payment.sale_line_id,
    v_payment.reservation_id,
    'refund',
    v_payment.amount_minor,
    'correction',
    'correction:' || v_payment.id::text,
    'Corrección administrativa: el pago original fue registrado por error y el dinero nunca se recibió. No hubo salida de efectivo.',
    btrim(p_reason),
    (select auth.uid()),
    coalesce(v_payment.effective_on, current_date)
  )
  returning id into v_offset;

  insert into private.payment_record_corrections(
    studio_id,
    sale_id,
    original_payment_id,
    offset_payment_id,
    amount_minor,
    reason,
    corrected_by
  ) values (
    v_payment.studio_id,
    v_payment.sale_id,
    v_payment.id,
    v_offset,
    v_payment.amount_minor,
    btrim(p_reason),
    (select auth.uid())
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'sale_id', v_payment.sale_id,
    'original_payment_id', v_payment.id,
    'offset_payment_id', v_offset,
    'amount_minor', v_payment.amount_minor
  );
end;
$;

revoke all on function public.admin_correct_unreceived_payment(uuid,text) from public, anon;
grant execute on function public.admin_correct_unreceived_payment(uuid,text) to authenticated;

create or replace function public.admin_delete_activity_program(p_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.activity_programs%rowtype;
  v_net_paid bigint := 0;
  v_reserved integer := 0;
  v_sessions integer := 0;
  v_sales_voided integer := 0;
  v_sale record;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select *
    into v_program
  from public.activity_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'program_not_found';
  end if;

  if not private.has_capability(v_program.studio_id, 'schedule.write')
     or not private.has_capability(v_program.studio_id, 'products.write') then
    raise exception 'forbidden';
  end if;

  if not v_program.active then
    return jsonb_build_object(
      'ok', true,
      'program_id', v_program.id,
      'program_name', v_program.name,
      'replayed', true,
      'sessions_cancelled', 0,
      'reservations_cancelled', 0
    );
  end if;

  select coalesce(sum(case when pay.kind::text = 'refund' then -pay.amount_minor else pay.amount_minor end), 0)
    into v_net_paid
  from public.payments pay
  where pay.studio_id = v_program.studio_id
    and pay.sale_id in (
      select distinct sl.sale_id
      from public.sale_lines sl
      where sl.studio_id = v_program.studio_id
        and (
          sl.product_template_id = v_program.full_product_id
          or sl.product_template_id in (
            select aps.single_product_id
            from public.activity_program_sessions aps
            where aps.program_id = v_program.id
              and aps.studio_id = v_program.studio_id
              and aps.single_product_id is not null
          )
        )
    );

  if v_net_paid <> 0 then
    raise exception 'program_has_recorded_payments';
  end if;

  select count(*)
    into v_reserved
  from public.reservations r
  join public.activity_program_sessions aps
    on aps.session_id = r.session_id
   and aps.studio_id = r.studio_id
  where aps.program_id = v_program.id
    and aps.studio_id = v_program.studio_id
    and r.status::text = 'reserved';

  -- The existing class_session_cancel_reservations trigger performs the actual
  -- reservation cancellation, credit release and waitlist expiration.
  update public.class_sessions s
  set status = 'cancelled',
      assistant_visible = false
  from public.activity_program_sessions aps
  where aps.program_id = v_program.id
    and aps.studio_id = v_program.studio_id
    and aps.session_id = s.id
    and s.studio_id = v_program.studio_id
    and s.status = 'scheduled';

  get diagnostics v_sessions = row_count;

  update public.class_templates
  set active = false
  where studio_id = v_program.studio_id
    and program_id = v_program.id;

  update public.product_templates pt
  set active = false,
      assistant_visible = false
  where pt.studio_id = v_program.studio_id
    and (
      pt.id = v_program.full_product_id
      or pt.id in (
        select aps.single_product_id
        from public.activity_program_sessions aps
        where aps.program_id = v_program.id
          and aps.studio_id = v_program.studio_id
          and aps.single_product_id is not null
      )
    );

  update public.activity_programs
  set active = false
  where id = v_program.id
    and studio_id = v_program.studio_id;

  -- Once all reservations are cancelled and the program has zero net collection,
  -- void standalone legacy-program sales so their acquisitions stop appearing active.
  for v_sale in
    select distinct s.id
    from public.sales s
    join public.sale_lines sl on sl.sale_id = s.id and sl.studio_id = s.studio_id
    where s.studio_id = v_program.studio_id
      and s.status::text = 'confirmed'
      and (
        sl.product_template_id = v_program.full_product_id
        or sl.product_template_id in (
          select aps.single_product_id
          from public.activity_program_sessions aps
          where aps.program_id = v_program.id
            and aps.studio_id = v_program.studio_id
            and aps.single_product_id is not null
        )
      )
      and not exists (
        select 1
        from public.sale_lines other_line
        where other_line.sale_id = s.id
          and other_line.studio_id = s.studio_id
          and other_line.product_template_id <> v_program.full_product_id
          and other_line.product_template_id not in (
            select aps.single_product_id
            from public.activity_program_sessions aps
            where aps.program_id = v_program.id
              and aps.studio_id = v_program.studio_id
              and aps.single_product_id is not null
          )
      )
  loop
    perform public.void_sale(
      v_sale.id,
      'Programa eliminado: ' || v_program.name || '. Venta sin ingreso neto.'
    );
    v_sales_voided := v_sales_voided + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'program_id', v_program.id,
    'program_name', v_program.name,
    'replayed', false,
    'sessions_cancelled', v_sessions,
    'reservations_cancelled', v_reserved,
    'sales_voided', v_sales_voided
  );
end;
$$;

revoke all on function public.admin_delete_activity_program(uuid) from public, anon;
grant execute on function public.admin_delete_activity_program(uuid) to authenticated;
