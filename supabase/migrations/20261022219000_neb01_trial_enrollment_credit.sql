-- NEB-01-36 · Nébora: precio de la primera clase y abono a la inscripción configurables.
-- Decisión de Mike (22-oct-2026): cada estudio decide si abona la primera clase a la inscripción,
-- cuánto, desde qué precio de inscripción y en cuántos días puede usarse. Valores de arranque =
-- los de Demeter hoy: primera clase $150, abono $150, inscripción mínima $150, mismo día.
-- El interruptor «abonar a la inscripción» sigue siendo la regla de Demi
-- 'trial_payment_towards_enrollment' (ya existe y le da a Demi el texto que explica el abono).

alter table public.trial_booking_policies
  add column if not exists trial_price_minor integer not null default 15000,
  add column if not exists enrollment_credit_minor integer not null default 15000,
  add column if not exists enrollment_credit_min_enrollment_minor integer not null default 15000,
  add column if not exists enrollment_credit_valid_days integer not null default 0;

alter table public.trial_booking_policies
  drop constraint if exists trial_booking_policies_neb_price_check;
alter table public.trial_booking_policies
  add constraint trial_booking_policies_neb_price_check check (
    trial_price_minor between 1 and 10000000
    and enrollment_credit_minor between 1 and 10000000
    and enrollment_credit_min_enrollment_minor between 0 and 10000000
    and enrollment_credit_valid_days between 0 and 30);

-- El abono guardado ya no está atado a $150.
do $migration$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.trial_enrollment_credits'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%15000%'
  loop
    execute format('alter table public.trial_enrollment_credits drop constraint %I', v_name);
  end loop;
end
$migration$;
alter table public.trial_enrollment_credits
  drop constraint if exists trial_enrollment_credits_neb_amount_check;
alter table public.trial_enrollment_credits
  add constraint trial_enrollment_credits_neb_amount_check check (amount_minor > 0);

create or replace function private.trial_policy(p_studio_id uuid)
returns public.trial_booking_policies
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy public.trial_booking_policies%rowtype;
begin
  select * into v_policy from public.trial_booking_policies where studio_id = p_studio_id;
  if not found then
    v_policy.studio_id := p_studio_id;
    v_policy.trial_price_minor := 15000;
    v_policy.enrollment_credit_minor := 15000;
    v_policy.enrollment_credit_min_enrollment_minor := 15000;
    v_policy.enrollment_credit_valid_days := 0;
  end if;
  return v_policy;
end;
$$;
revoke all on function private.trial_policy(uuid) from public, anon, authenticated;

-- Ajustes sobre las definiciones vigentes (si una no tiene el texto esperado, se detiene).
create or replace function pg_temp.neb_patch_all(p_signature text, p_pairs text[], p_label text)
returns void
language plpgsql
as $$
declare
  v_def text;
  v_new text;
  i integer;
begin
  if to_regprocedure(p_signature) is null then
    raise notice 'NEB-01: % no existe en esta base; se omite (%)', p_signature, p_label;
    return;
  end if;
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_new := v_def;
  for i in 1 .. array_length(p_pairs, 1) by 2 loop
    if position(p_pairs[i] in v_new) = 0 then
      raise exception 'NEB-01: definición inesperada de % (%): falta «%»', p_signature, p_label, p_pairs[i];
    end if;
    v_new := replace(v_new, p_pairs[i], p_pairs[i + 1]);
  end loop;
  execute v_new;
end;
$$;

-- Opciones de abono: la venta de primera clase vale lo que se cobró; el abono es el configurado
-- (nunca más de lo pagado) y puede usarse los días configurados después de la clase.
select pg_temp.neb_patch_all('public.get_trial_enrollment_credit_options(uuid)', array[
  '''amount_minor'',15000,',
  '''amount_minor'',least((private.trial_policy(st.studio_id)).enrollment_credit_minor,sa.total_minor),''min_enrollment_minor'',(private.trial_policy(st.studio_id)).enrollment_credit_min_enrollment_minor,',
  'sa.total_minor=15000',
  'sa.total_minor>0',
  'p.amount_minor=15000',
  'p.amount_minor=sa.total_minor',
  '::date=today',
  '::date between today-(private.trial_policy(st.studio_id)).enrollment_credit_valid_days and today'
], 'opciones de abono');

-- Compra con abono: usa el monto de la opción y la inscripción mínima configurada.
select pg_temp.neb_patch_all(
  'public.create_package_with_trial_enrollment_credit(uuid,uuid,uuid,uuid,uuid,text,date,integer,text,date,text,text)',
  array[
    '''trial_credit_minor'',15000);' || E'\n' || ' end if;',
    '''trial_credit_minor'',prior.amount_minor);' || E'\n' || ' end if;',
    'enroll.price_minor<15000',
    'enroll.price_minor<(private.trial_policy(st.studio_id)).enrollment_credit_min_enrollment_minor or enroll.price_minor<(option->>''amount_minor'')::integer',
    'enroll.price_minor-15000',
    'enroll.price_minor-(option->>''amount_minor'')::integer',
    'discount_minor=15000',
    'discount_minor=(option->>''amount_minor'')::integer',
    'Abono de $150 ya cobrado.',
    'Abono de primera clase ya cobrado.',
    'unit_price_minor-15000',
    'unit_price_minor-(option->>''amount_minor'')::integer',
    'line,15000,today',
    'line,(option->>''amount_minor'')::integer,today',
    '''trial_credit_minor'',15000);',
    '''trial_credit_minor'',(option->>''amount_minor'')::integer);'
  ], 'compra con abono');

-- Demi cobra la primera clase al precio configurado.
select pg_temp.neb_patch_all(
  'public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid)',
  array['''amount_minor'',15000,', '''amount_minor'',(private.trial_policy(target_studio_id)).trial_price_minor,'],
  'Demi: precio de primera clase');
select pg_temp.neb_patch_all(
  'public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid)',
  array[
    'coalesce(15000,0)', 'coalesce((private.trial_policy(target_studio_id)).trial_price_minor,0)',
    'v_product.id,15000,', 'v_product.id,(private.trial_policy(target_studio_id)).trial_price_minor,',
    '''amount_minor'',15000,', '''amount_minor'',(private.trial_policy(target_studio_id)).trial_price_minor,'
  ],
  'Demi: precio de primera clase');

-- Guardar desde Configuración › Reservas › Primera clase.
create or replace function public.owner_update_studio_trial_credit(
  p_studio_id uuid,
  p_trial_price_minor integer,
  p_credit_enabled boolean,
  p_enrollment_credit_minor integer,
  p_enrollment_credit_min_enrollment_minor integer,
  p_enrollment_credit_valid_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_studio_id, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.trial_booking_policies (studio_id) values (p_studio_id)
  on conflict (studio_id) do nothing;
  update public.trial_booking_policies set
    trial_price_minor = p_trial_price_minor,
    enrollment_credit_minor = p_enrollment_credit_minor,
    enrollment_credit_min_enrollment_minor = p_enrollment_credit_min_enrollment_minor,
    enrollment_credit_valid_days = p_enrollment_credit_valid_days,
    updated_at = now()
  where studio_id = p_studio_id;

  insert into public.assistant_admin_rules (studio_id, rule_key, category, instruction, enabled, created_by, updated_by)
  values (p_studio_id, 'trial_payment_towards_enrollment', 'commercial',
    'Si la alumna pagó su primera clase, ese pago se abona a su inscripción cuando compra su paquete, según las reglas del estudio.',
    coalesce(p_credit_enabled, false), (select auth.uid()), (select auth.uid()))
  on conflict (studio_id, rule_key) do update set
    enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = clock_timestamp();
end;
$$;
revoke all on function public.owner_update_studio_trial_credit(uuid, integer, boolean, integer, integer, integer) from public, anon;
grant execute on function public.owner_update_studio_trial_credit(uuid, integer, boolean, integer, integer, integer) to authenticated;
