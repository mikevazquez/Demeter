create or replace function public.admin_set_acquisition_available_credits(
  target_acquisition_id uuid,
  target_available integer,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_acquisition public.product_acquisitions%rowtype;
  v_current integer;
  v_delta integer;
  v_reason text := nullif(trim(coalesce(target_reason, '')), '');
  v_timezone text;
  v_today date;
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

  select timezone into v_timezone
  from public.studios
  where id = v_acquisition.studio_id;

  v_today := (now() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;

  if v_acquisition.status <> 'active'
     or v_acquisition.refunded_at is not null
     or (v_acquisition.starts_on is not null and v_acquisition.starts_on > v_today)
     or (v_acquisition.expires_on is not null and v_acquisition.expires_on < v_today) then
    raise exception 'acquisition_not_editable';
  end if;

  if v_acquisition.unlimited then raise exception 'unlimited_acquisition'; end if;

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
$function$;

create or replace function public.admin_set_acquisition_start_date(
  target_acquisition_id uuid,
  target_starts_on date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_acquisition public.product_acquisitions%rowtype;
  v_product public.product_templates%rowtype;
  v_timezone text;
  v_today date;
  v_expires_on date;
  v_status public.product_acquisition_status;
  v_validity_days integer;
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

  select timezone into v_timezone
  from public.studios
  where id = v_acquisition.studio_id;

  v_today := (now() at time zone coalesce(v_timezone, 'America/Mexico_City'))::date;

  if v_acquisition.status <> 'active'
     or v_acquisition.refunded_at is not null
     or (v_acquisition.starts_on is not null and v_acquisition.starts_on > v_today)
     or (v_acquisition.expires_on is not null and v_acquisition.expires_on < v_today) then
    raise exception 'acquisition_not_editable';
  end if;

  select * into v_product
  from public.product_templates
  where id = v_acquisition.product_template_id
    and studio_id = v_acquisition.studio_id;

  if not found then raise exception 'product_not_found'; end if;

  v_validity_days := coalesce(v_acquisition.validity_days_snapshot, v_product.validity_days);
  if v_validity_days is null then raise exception 'product_validity_missing'; end if;

  v_expires_on := target_starts_on + v_validity_days;
  v_status := case when v_expires_on < v_today then 'expired' else 'active' end;

  update public.product_acquisitions
  set
    starts_on = target_starts_on,
    expires_on = v_expires_on,
    activation_mode = 'fixed_date',
    validity_days_snapshot = v_validity_days,
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
$function$;
