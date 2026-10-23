-- NEB-01-18 · Detector de errores de configuración por estudio.
-- Cada regla regresa gravedad (error / warning / suggestion), cuántos casos hay y a dónde ir a corregir.
-- Alimenta: Más › Revisión de configuración (dueña), Diagnóstico del modo soporte y la consola.

create or replace function private.studio_config_issues(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_issues jsonb := '[]'::jsonb;
  v_count integer;
  v_birth_definition uuid;
begin
  -- 1 · Paquetes, membresías, clases sueltas e inscripciones activas sin precio.
  select count(*) into v_count from public.product_templates p
  where p.studio_id = p_studio and p.active and p.price_minor <= 0
    and p.product_type::text in ('package', 'membership', 'single_class', 'enrollment');
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'product_price_missing', 'severity', 'error', 'count', v_count,
      'title', 'Paquetes activos sin precio', 'detail', 'Se venderían en $0. Pon el precio o desactívalos.',
      'href', '/admin/productos');
  end if;

  -- 2 · Paquetes con créditos sin número de clases.
  select count(*) into v_count from public.product_templates p
  where p.studio_id = p_studio and p.active and p.product_type::text = 'package'
    and not coalesce(p.unlimited, false) and coalesce(p.credit_limit, 0) <= 0;
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'package_credits_missing', 'severity', 'error', 'count', v_count,
      'title', 'Paquetes sin número de clases', 'detail', 'La alumna no podría reservar con ellos. Indica cuántas clases incluyen o márcalos como ilimitados.',
      'href', '/admin/productos');
  end if;

  -- 3 · Paquetes y membresías sin vigencia.
  select count(*) into v_count from public.product_templates p
  where p.studio_id = p_studio and p.active and p.product_type::text in ('package', 'membership')
    and coalesce(p.validity_days, 0) <= 0;
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'package_validity_missing', 'severity', 'warning', 'count', v_count,
      'title', 'Paquetes sin vigencia', 'detail', 'No vencerían nunca. Revisa cuántos días duran.',
      'href', '/admin/productos');
  end if;

  -- 4 · Clases de los próximos 14 días sin coach.
  select count(*) into v_count from public.class_sessions cs
  where cs.studio_id = p_studio and cs.status = 'scheduled'
    and cs.starts_at >= v_now and cs.starts_at < v_now + interval '14 days'
    and cs.instructor_id is null and cs.coach_user_id is null;
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'session_coach_missing', 'severity', 'warning', 'count', v_count,
      'title', 'Clases sin coach en las próximas 2 semanas', 'detail', 'Asigna quién da cada clase para que la alumna lo vea y el coach reciba su lista.',
      'href', '/admin/agenda');
  end if;

  -- 5 · Clases de los próximos 14 días con cupo 0.
  select count(*) into v_count from public.class_sessions cs
  where cs.studio_id = p_studio and cs.status = 'scheduled'
    and cs.starts_at >= v_now and cs.starts_at < v_now + interval '14 days'
    and coalesce(cs.capacity, 0) <= 0;
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'session_capacity_zero', 'severity', 'error', 'count', v_count,
      'title', 'Clases con cupo 0', 'detail', 'Nadie podría reservarlas. Ajusta el cupo en la agenda.',
      'href', '/admin/agenda');
  end if;

  -- 6 · Actividades activas sin precio de clase suelta (no talleres).
  select count(*) into v_count from public.class_templates ct
  where ct.studio_id = p_studio and ct.active and ct.workshop_offer_id is null and ct.drop_in_price_minor is null;
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'activity_drop_in_missing', 'severity', 'suggestion', 'count', v_count,
      'title', 'Actividades sin precio de clase suelta', 'detail', 'Sin precio, la alumna sin paquete no puede comprar esa clase sola.',
      'href', '/admin/actividades');
  end if;

  -- 7 · Sin políticas de operación (cancelación, faltas) guardadas.
  if not exists (select 1 from public.studio_operating_policies o where o.studio_id = p_studio) then
    v_issues := v_issues || jsonb_build_object('code', 'operating_policy_missing', 'severity', 'warning', 'count', 1,
      'title', 'Reglas de reserva sin revisar', 'detail', 'Se usan los valores de Nébora. Revisa cancelación, cierre de reservas y registro con QR.',
      'href', '/admin/configuracion/reservas');
  end if;

  -- 8 · Sin métodos de pago activos.
  if not exists (select 1 from public.studio_payment_methods m where m.studio_id = p_studio and m.active) then
    v_issues := v_issues || jsonb_build_object('code', 'payment_methods_missing', 'severity', 'error', 'count', 1,
      'title', 'Sin métodos de pago activos', 'detail', 'No se podrían registrar ventas. Escríbenos en Ayuda de Nébora para activarlos.',
      'href', null);
  end if;

  -- 9 · Alumnas activas sin fecha de nacimiento.
  select d.id into v_birth_definition from public.profile_field_definitions d
  where d.studio_id = p_studio and d.entity_type = 'student' and d.key = 'birth_date' and d.active
  limit 1;
  select count(*) into v_count from public.students s
  where s.studio_id = p_studio and s.active and s.lifecycle_status = 'active'
    and (v_birth_definition is null or not exists (
      select 1 from public.profile_field_values v
      where v.definition_id = v_birth_definition and v.person_id = s.person_id
        and nullif(v.value #>> '{}', '') is not null));
  if v_count > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'student_birth_date_missing', 'severity', 'suggestion', 'count', v_count,
      'title', 'Alumnas sin fecha de nacimiento', 'detail', 'Sin fecha no reciben su saludo ni su regalo de cumpleaños.',
      'href', '/admin/alumnas');
  end if;

  return v_issues;
end;
$$;
revoke all on function private.studio_config_issues(uuid) from public, anon, authenticated;

-- Dueña / admin con permiso de ajustes.
create or replace function public.studio_config_issues(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_capability(p_studio, 'settings.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.studio_config_issues(p_studio);
end;
$$;
revoke all on function public.studio_config_issues(uuid) from public, anon;
grant execute on function public.studio_config_issues(uuid) to authenticated;

-- Consola: errores y avisos por estudio (solo conteos).
create or replace function public.platform_config_issue_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_admin();
  return coalesce((
    select jsonb_object_agg(st.id, jsonb_build_object(
      'errors', (select count(*) from jsonb_array_elements(i.issues) e where e->>'severity' = 'error'),
      'warnings', (select count(*) from jsonb_array_elements(i.issues) e where e->>'severity' = 'warning')))
    from public.studios st
    cross join lateral (select private.studio_config_issues(st.id) as issues) i), '{}'::jsonb);
end;
$$;
revoke all on function public.platform_config_issue_counts() from public, anon;
grant execute on function public.platform_config_issue_counts() to authenticated;

-- El Diagnóstico del modo soporte también muestra la revisión.
create or replace function public.platform_support_diagnostics(p_studio uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform private.platform_require_support(p_studio, 'diagnostico');
  return jsonb_build_object(
    'classes_next_7_days', (select count(*) from public.class_sessions cs
      where cs.studio_id = p_studio and cs.status = 'scheduled'
        and cs.starts_at >= v_now and cs.starts_at < v_now + interval '7 days'),
    'reservations_next_7_days', (select count(*) from public.reservations r
      join public.class_sessions cs on cs.id = r.session_id
      where r.studio_id = p_studio and r.status = 'reserved'
        and cs.starts_at >= v_now and cs.starts_at < v_now + interval '7 days'),
    'classes_without_reservations_7_days', (select count(*) from public.class_sessions cs
      where cs.studio_id = p_studio and cs.status = 'scheduled'
        and cs.starts_at >= v_now and cs.starts_at < v_now + interval '7 days'
        and not exists (select 1 from public.reservations r where r.session_id = cs.id and r.status = 'reserved')),
    'sales_with_due_date', (select count(*) from public.sales s
      where s.studio_id = p_studio and s.status = 'confirmed' and s.payment_due_on is not null),
    'products_active', (select count(*) from public.product_templates p where p.studio_id = p_studio and p.active),
    'products_inactive', (select count(*) from public.product_templates p where p.studio_id = p_studio and not p.active),
    'issues', private.studio_config_issues(p_studio)
  );
end;
$$;
revoke all on function public.platform_support_diagnostics(uuid) from public, anon;
grant execute on function public.platform_support_diagnostics(uuid) to authenticated;
