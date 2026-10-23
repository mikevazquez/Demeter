-- NEB-01-10/11/12 · Nébora: lecturas de la consola de plataforma.
-- Decisiones de Mike (22-oct-2026):
--  * Todo por estudio, no regado: alumnas, clases, reservas, ventas, consumo de Demi,
--    fecha de corte, renovación, plan y módulos.
--  * Solo la plataforma (platform_admins) puede leer esto; un estudio nunca ve a otro.
-- Solo lecturas. Las escrituras siguen siendo platform_set_studio_plan/module/status (NEB-01-02).
-- Estados de reserva (enum reservation_status): reserved, attended, cancelled_on_time,
-- cancelled_late, no_show, cancelled_by_studio. Se comparan como texto.
-- "Este mes" y "esta semana" se cuentan en hora de Ciudad de México.

create or replace function private.platform_month_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';
$$;
revoke all on function private.platform_month_start() from public, anon, authenticated;

create or replace function private.platform_week_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';
$$;
revoke all on function private.platform_week_start() from public, anon, authenticated;

-- Siguiente fecha de corte (día 1..28) a partir de hoy; null si no tiene día de corte.
create or replace function private.platform_next_cut_on(p_cut_day smallint)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when p_cut_day is null then null
    when extract(day from (now() at time zone 'America/Mexico_City'))::int <= p_cut_day
      then (date_trunc('month', now() at time zone 'America/Mexico_City')::date + (p_cut_day - 1))
    else ((date_trunc('month', now() at time zone 'America/Mexico_City') + interval '1 month')::date + (p_cut_day - 1))
  end;
$$;
revoke all on function private.platform_next_cut_on(smallint) from public, anon, authenticated;

-- Módulos que un estudio pidió activar y todavía no tiene.
create or replace function private.platform_pending_requests(p_studio uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('module', r.module, 'requested_at', r.requested_at)
    order by r.requested_at desc), '[]'::jsonb)
  from (
    select l.studio_id, l.detail ->> 'module' as module, max(l.occurred_at) as requested_at
    from public.platform_audit_log l
    where l.action = 'studio.module.requested' and (p_studio is null or l.studio_id = p_studio)
    group by l.studio_id, l.detail ->> 'module'
  ) r
  where not private.studio_has_module(r.studio_id, r.module);
$$;
revoke all on function private.platform_pending_requests(uuid) from public, anon, authenticated;

create or replace function private.platform_studio_students_active(p_studio uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.students s where s.studio_id = p_studio and s.active = true;
$$;
revoke all on function private.platform_studio_students_active(uuid) from public, anon, authenticated;

-- NEB-01-10 · Inicio de la consola.
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.platform_require_admin();
  select jsonb_build_object(
    'studios_total', count(*),
    'studios_by_status', coalesce((
      select jsonb_object_agg(x.status, x.n) from (
        select status, count(*) as n from public.studio_subscriptions group by status
      ) x), '{}'::jsonb),
    'mrr_mxn', coalesce(sum(private.studio_monthly_price_mxn(sub.studio_id))
      filter (where sub.status in ('active', 'grace')), 0),
    'founding_used', count(*) filter (where sub.plan_key = 'founding'),
    'founding_seats', private.platform_setting('founding_seats'),
    'students_active', coalesce(sum(private.platform_studio_students_active(sub.studio_id)), 0),
    'pending_requests', jsonb_array_length(private.platform_pending_requests(null)),
    'generated_at', now()
  ) into v_result
  from public.studio_subscriptions sub;
  return v_result;
end;
$$;
revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

-- NEB-01-10 · Lista de estudios con lo esencial.
create or replace function public.platform_list_studios()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.platform_require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'brand_name', coalesce(s.brand_name, s.name),
    'slug', s.slug,
    'plan', sub.plan_key,
    'plan_label', p.label,
    'status', sub.status,
    'monthly_price_mxn', private.studio_monthly_price_mxn(s.id),
    'founding_month', case when sub.plan_key = 'founding' and sub.founding_started_on is not null
      then (extract(year from age(current_date, sub.founding_started_on)) * 12
        + extract(month from age(current_date, sub.founding_started_on)))::int + 1 end,
    'cut_day', sub.cut_day,
    'next_cut_on', private.platform_next_cut_on(sub.cut_day),
    'students_active', private.platform_studio_students_active(s.id),
    'pending_requests', jsonb_array_length(private.platform_pending_requests(s.id))
  ) order by s.name), '[]'::jsonb) into v_result
  from public.studios s
  join public.studio_subscriptions sub on sub.studio_id = s.id
  join public.platform_plans p on p.key = sub.plan_key;
  return v_result;
end;
$$;
revoke all on function public.platform_list_studios() from public, anon;
grant execute on function public.platform_list_studios() to authenticated;

-- NEB-01-11/12 · Ficha del estudio: números, plan, módulos, solicitudes y bitácora.
create or replace function public.platform_studio_detail(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamptz := private.platform_month_start();
  v_week timestamptz := private.platform_week_start();
  v_studio public.studios;
  v_sub public.studio_subscriptions;
begin
  perform private.platform_require_admin();
  select * into v_studio from public.studios where id = p_studio;
  if v_studio.id is null then raise exception 'studio_not_found'; end if;
  select * into v_sub from public.studio_subscriptions where studio_id = p_studio;

  return jsonb_build_object(
    'studio', jsonb_build_object(
      'id', v_studio.id,
      'name', v_studio.name,
      'brand_name', coalesce(v_studio.brand_name, v_studio.name),
      'slug', v_studio.slug),
    'entitlements', private.studio_entitlements(p_studio),
    'next_cut_on', private.platform_next_cut_on(v_sub.cut_day),
    'status_changed_at', v_sub.status_changed_at,
    'grace_started_at', v_sub.grace_started_at,
    'students', (select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where st.active),
        'new_this_month', count(*) filter (where st.created_at >= v_month))
      from public.students st where st.studio_id = p_studio),
    'students_with_package', (select count(distinct pa.student_id)
      from public.product_acquisitions pa
      where pa.studio_id = p_studio and pa.status::text = 'active'
        and (pa.expires_on is null or pa.expires_on >= current_date)),
    'classes', (select jsonb_build_object(
        'this_week', count(*) filter (where cs.starts_at >= v_week and cs.starts_at < v_week + interval '7 days'),
        'this_month', count(*) filter (where cs.starts_at >= v_month and cs.starts_at < v_month + interval '1 month'))
      from public.class_sessions cs
      where cs.studio_id = p_studio and cs.status::text <> 'cancelled'),
    'reservations_month', (select jsonb_build_object(
        'booked', count(*) filter (where r.status::text not like 'cancelled%'),
        'attended', count(*) filter (where r.status::text = 'attended'),
        'cancelled', count(*) filter (where r.status::text like 'cancelled%'))
      from public.reservations r
      where r.studio_id = p_studio and r.booked_at >= v_month),
    'sales_month', (select jsonb_build_object(
        'count', count(*),
        'total_minor', coalesce(sum(sa.total_minor), 0))
      from public.sales sa
      where sa.studio_id = p_studio and sa.status::text = 'confirmed' and sa.created_at >= v_month),
    'demi_month', (select jsonb_build_object(
        'calls', count(*),
        'input_tokens', coalesce(sum(mc.input_tokens), 0),
        'output_tokens', coalesce(sum(mc.output_tokens), 0),
        'cost_usd_micros', coalesce(sum(mc.estimated_cost_usd_micros), 0))
      from public.assistant_model_calls mc
      where mc.studio_id = p_studio and mc.created_at >= v_month),
    'owner_last_sign_in_at', (select max(u.last_sign_in_at)
      from public.studio_memberships m join auth.users u on u.id = m.user_id
      where m.studio_id = p_studio and m.role = 'owner' and m.active = true),
    'pending_requests', private.platform_pending_requests(p_studio),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
        'occurred_at', l.occurred_at, 'action', l.action, 'detail', l.detail)
        order by l.occurred_at desc, l.id desc)
      from (select * from public.platform_audit_log
        where studio_id = p_studio order by occurred_at desc, id desc limit 20) l), '[]'::jsonb),
    'generated_at', now()
  );
end;
$$;
revoke all on function public.platform_studio_detail(uuid) from public, anon;
grant execute on function public.platform_studio_detail(uuid) to authenticated;
