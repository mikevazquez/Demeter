alter table public.product_templates
  add column if not exists package_term text;

update public.product_templates
set package_term = case
  when validity_days = 30 then 'monthly'
  when validity_days = 90 then 'quarterly'
  when validity_days = 180 then 'semiannual'
  when validity_days = 365 then 'annual'
  else 'custom'
end
where product_type::text in ('package', 'membership')
  and package_term is null;

update public.product_templates
set package_term = null
where product_type::text not in ('package', 'membership')
  and package_term is not null;

alter table public.product_templates
  drop constraint if exists product_templates_package_term_check;

alter table public.product_templates
  add constraint product_templates_package_term_check
  check (
    (
      product_type::text in ('package', 'membership')
      and package_term in ('monthly', 'quarterly', 'semiannual', 'annual', 'custom')
    )
    or (
      product_type::text not in ('package', 'membership')
      and package_term is null
    )
  );

create index if not exists product_templates_catalog_idx
  on public.product_templates(studio_id, active, product_type, package_term);

alter table public.class_templates
  add column if not exists drop_in_price_minor integer;

alter table public.class_templates
  drop constraint if exists class_templates_drop_in_price_nonnegative;

alter table public.class_templates
  add constraint class_templates_drop_in_price_nonnegative
  check (drop_in_price_minor is null or drop_in_price_minor >= 0);

create or replace function public.admin_set_acquisition_start_date(
  target_acquisition_id uuid,
  target_starts_on date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_acquisition public.product_acquisitions%rowtype;
  v_product public.product_templates%rowtype;
  v_timezone text;
  v_today date;
  v_expires_on date;
  v_status public.product_acquisition_status;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_starts_on is null then raise exception 'start_date_required'; end if;

  select * into v_acquisition
  from public.product_acquisitions
  where id = target_acquisition_id
  for update;

  if not found then raise exception 'acquisition_not_found'; end if;

  if not (
    private.has_capability(v_acquisition.studio_id, 'products.write')
    or private.has_capability(v_acquisition.studio_id, 'sales.write')
  ) then
    raise exception 'forbidden';
  end if;

  if v_acquisition.status = 'cancelled' or v_acquisition.refunded_at is not null then
    raise exception 'acquisition_not_editable';
  end if;

  select * into v_product
  from public.product_templates
  where id = v_acquisition.product_template_id
    and studio_id = v_acquisition.studio_id;

  if not found then raise exception 'product_not_found'; end if;
  if v_product.validity_days is null then raise exception 'product_validity_missing'; end if;

  v_expires_on := target_starts_on + v_product.validity_days;

  select timezone into v_timezone
  from public.studios
  where id = v_acquisition.studio_id;

  v_today := (now() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;
  v_status := case when v_expires_on < v_today then 'expired' else 'active' end;

  update public.product_acquisitions
  set starts_on = target_starts_on,
      expires_on = v_expires_on,
      status = v_status,
      updated_at = now()
  where id = v_acquisition.id;

  return jsonb_build_object(
    'ok', true,
    'acquisition_id', v_acquisition.id,
    'starts_on', target_starts_on,
    'expires_on', v_expires_on,
    'status', v_status::text
  );
end;
$$;

revoke all on function public.admin_set_acquisition_start_date(uuid, date) from public, anon;
grant execute on function public.admin_set_acquisition_start_date(uuid, date) to authenticated, service_role;

create or replace function public.admin_set_acquisition_available_credits(
  target_acquisition_id uuid,
  target_available integer,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_acquisition public.product_acquisitions%rowtype;
  v_current integer;
  v_delta integer;
  v_reason text := nullif(trim(coalesce(target_reason, '')), '');
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if target_available is null or target_available < 0 then raise exception 'credits_invalid'; end if;
  if target_available > 100000 then raise exception 'credits_invalid'; end if;
  if v_reason is null then raise exception 'adjustment_reason_required'; end if;

  select * into v_acquisition
  from public.product_acquisitions
  where id = target_acquisition_id
  for update;

  if not found then raise exception 'acquisition_not_found'; end if;

  if not (
    private.has_capability(v_acquisition.studio_id, 'products.write')
    or private.has_capability(v_acquisition.studio_id, 'sales.write')
  ) then
    raise exception 'forbidden';
  end if;

  if v_acquisition.unlimited then raise exception 'unlimited_acquisition'; end if;
  if v_acquisition.status = 'cancelled' or v_acquisition.refunded_at is not null then
    raise exception 'acquisition_not_editable';
  end if;

  select coalesce(sum(quantity), 0)::integer
  into v_current
  from public.credit_ledger
  where acquisition_id = v_acquisition.id;

  v_delta := target_available - v_current;

  if v_delta <> 0 then
    insert into public.credit_ledger(
      studio_id,
      acquisition_id,
      movement_type,
      quantity,
      note,
      created_by
    ) values (
      v_acquisition.studio_id,
      v_acquisition.id,
      'adjustment',
      v_delta,
      'Ajuste manual: ' || left(v_reason, 500),
      (select auth.uid())
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'acquisition_id', v_acquisition.id,
    'previous_available', v_current,
    'available_credits', target_available,
    'delta', v_delta
  );
end;
$$;

revoke all on function public.admin_set_acquisition_available_credits(uuid, integer, text) from public, anon;
grant execute on function public.admin_set_acquisition_available_credits(uuid, integer, text) to authenticated, service_role;

create or replace function public.student_session_detail(target_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then raise exception 'session_not_found'; end if;

  select s.* into v_student
  from public.students s
  where s.studio_id = v_session.studio_id
    and s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  limit 1;

  if not found then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'session_id', cs.id,
    'starts_at', cs.starts_at,
    'ends_at', cs.ends_at,
    'capacity', cs.capacity,
    'spots_available', greatest(
      cs.capacity - (
        select count(*)
        from public.reservations r
        where r.session_id = cs.id
          and r.status in ('reserved', 'attended')
      ),
      0
    ),
    'activity', ct.name,
    'discipline_id', d.id,
    'discipline', d.name,
    'credit_cost', greatest(coalesce(ct.credit_cost, 1), 1),
    'drop_in_price_minor', ct.drop_in_price_minor,
    'space', sp.name,
    'location', sl.name,
    'coach', nullif(trim(concat_ws(' ', ip.first_name, ip.last_name)), ''),
    'description', cs.notes,
    'eligibility', public.booking_eligibility(cs.id, v_student.id),
    'reservation_id', (
      select r.id
      from public.reservations r
      where r.session_id = cs.id
        and r.student_id = v_student.id
        and r.status in ('reserved', 'attended')
      order by r.booked_at desc
      limit 1
    )
  ) into v_result
  from public.class_sessions cs
  join public.class_templates ct on ct.id = cs.template_id
  join public.disciplines d on d.id = ct.discipline_id
  left join public.spaces sp on sp.id = cs.space_id
  left join public.studio_locations sl on sl.id = cs.location_id
  left join public.instructors i on i.id = cs.instructor_id
  left join public.persons ip on ip.id = i.person_id
  where cs.id = target_session_id;

  return v_result;
end;
$$;

revoke all on function public.student_session_detail(uuid) from public, anon;
grant execute on function public.student_session_detail(uuid) to authenticated, service_role;
