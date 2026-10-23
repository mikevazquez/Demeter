-- NEB-01-17 · Consola de Nébora: entrar al estudio como soporte, con aviso al dueño y bitácora.
-- Notas de Mike: entra directo, sin esperar aprobación; se avisa al dueño; cada lectura y cambio
-- queda en bitácora; pestañas Diagnóstico, Paquetes (editables), Horario y Bitácora.
-- Valores de Claude (a confirmar en el UAT): motivo obligatorio, sesión de 2 horas, una abierta
-- por admin y estudio; no se suplanta la cuenta de la dueña: todo pasa por funciones de plataforma.
-- Producción queda bloqueada por NEB-01-24 (el contrato debe autorizar el acceso de soporte).

create table if not exists public.platform_support_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > started_at),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists platform_support_sessions_studio_idx
  on public.platform_support_sessions (studio_id, started_at desc);
create unique index if not exists platform_support_sessions_one_open_idx
  on public.platform_support_sessions (studio_id, admin_user_id)
  where ended_at is null;

alter table public.platform_support_sessions enable row level security;
revoke all on table public.platform_support_sessions from anon, authenticated;

-- Sesión abierta y vigente del admin que llama (cierra sola la que ya venció).
create or replace function private.platform_support_session(p_studio uuid)
returns public.platform_support_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.platform_support_sessions%rowtype;
begin
  select * into v_session
  from public.platform_support_sessions s
  where s.studio_id = p_studio and s.admin_user_id = (select auth.uid()) and s.ended_at is null
  limit 1;
  if found and v_session.expires_at <= clock_timestamp() then
    update public.platform_support_sessions set ended_at = v_session.expires_at where id = v_session.id;
    perform private.platform_audit(p_studio, 'support.session.expired', jsonb_build_object('session', v_session.id));
    return null;
  end if;
  return v_session;
end;
$$;
revoke all on function private.platform_support_session(uuid) from public, anon, authenticated;

create or replace function private.platform_require_support(p_studio uuid, p_tab text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.platform_support_sessions%rowtype;
begin
  perform private.platform_require_admin();
  v_session := private.platform_support_session(p_studio);
  if v_session.id is null then
    raise exception 'support_session_required';
  end if;
  if p_tab is not null then
    perform private.platform_audit(p_studio, 'support.read',
      jsonb_build_object('session', v_session.id, 'tab', p_tab));
  end if;
  return v_session.id;
end;
$$;
revoke all on function private.platform_require_support(uuid, text) from public, anon, authenticated;

create or replace function public.platform_start_support_session(p_studio uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.platform_require_admin();
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  v_session public.platform_support_sessions%rowtype;
begin
  if not exists (select 1 from public.studios where id = p_studio) then
    raise exception 'studio_not_found';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'support_reason_required';
  end if;

  v_session := private.platform_support_session(p_studio);
  if v_session.id is null then
    insert into public.platform_support_sessions (studio_id, admin_user_id, reason, started_at, expires_at)
    values (p_studio, v_admin, v_reason, clock_timestamp(), clock_timestamp() + interval '2 hours')
    returning * into v_session;
    perform private.platform_audit(p_studio, 'support.session.start',
      jsonb_build_object('session', v_session.id, 'reason', v_reason, 'expires_at', v_session.expires_at));
  end if;

  return jsonb_build_object('session_id', v_session.id, 'reason', v_session.reason,
    'started_at', v_session.started_at, 'expires_at', v_session.expires_at);
end;
$$;
revoke all on function public.platform_start_support_session(uuid, text) from public, anon;
grant execute on function public.platform_start_support_session(uuid, text) to authenticated;

create or replace function public.platform_end_support_session(p_studio uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.platform_support_sessions%rowtype;
begin
  perform private.platform_require_admin();
  v_session := private.platform_support_session(p_studio);
  if v_session.id is null then
    return;
  end if;
  update public.platform_support_sessions set ended_at = clock_timestamp() where id = v_session.id;
  perform private.platform_audit(p_studio, 'support.session.end', jsonb_build_object('session', v_session.id));
end;
$$;
revoke all on function public.platform_end_support_session(uuid) from public, anon;
grant execute on function public.platform_end_support_session(uuid) to authenticated;

create or replace function public.platform_support_state(p_studio uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.platform_support_sessions%rowtype;
begin
  perform private.platform_require_admin();
  v_session := private.platform_support_session(p_studio);
  if v_session.id is null then
    return jsonb_build_object('active', false);
  end if;
  return jsonb_build_object('active', true, 'session_id', v_session.id, 'reason', v_session.reason,
    'started_at', v_session.started_at, 'expires_at', v_session.expires_at);
end;
$$;
revoke all on function public.platform_support_state(uuid) from public, anon;
grant execute on function public.platform_support_state(uuid) to authenticated;

-- Diagnóstico: la semana del estudio en números (con sesión de soporte).
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
    'products_inactive', (select count(*) from public.product_templates p where p.studio_id = p_studio and not p.active)
  );
end;
$$;
revoke all on function public.platform_support_diagnostics(uuid) from public, anon;
grant execute on function public.platform_support_diagnostics(uuid) to authenticated;

-- Paquetes: lectura y cambios básicos (nombre, precio, activo) con antes y después en bitácora.
create or replace function public.platform_support_packages(p_studio uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_support(p_studio, 'paquetes');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'product_type', p.product_type::text, 'price_minor', p.price_minor,
      'credit_limit', p.credit_limit, 'validity_days', p.validity_days, 'unlimited', p.unlimited,
      'active', p.active, 'online_purchasable', p.online_purchasable
    ) order by p.active desc, p.product_type::text, p.price_minor, p.name)
    from public.product_templates p where p.studio_id = p_studio), '[]'::jsonb);
end;
$$;
revoke all on function public.platform_support_packages(uuid) from public, anon;
grant execute on function public.platform_support_packages(uuid) to authenticated;

create or replace function public.platform_support_update_package(
  p_studio uuid,
  p_product uuid,
  p_name text,
  p_price_minor integer,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := private.platform_require_support(p_studio, null);
  v_before public.product_templates%rowtype;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  select * into v_before from public.product_templates where id = p_product and studio_id = p_studio for update;
  if not found then
    raise exception 'product_not_found';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'product_name_invalid';
  end if;
  if p_price_minor is null or p_price_minor < 0 or p_price_minor > 100000000 then
    raise exception 'product_price_invalid';
  end if;
  if p_active is null then
    raise exception 'product_active_invalid';
  end if;
  if v_before.name = v_name and v_before.price_minor = p_price_minor and v_before.active = p_active then
    return;
  end if;

  update public.product_templates
  set name = v_name, price_minor = p_price_minor, active = p_active, updated_at = now()
  where id = p_product;

  perform private.platform_audit(p_studio, 'support.package.update', jsonb_build_object(
    'session', v_session, 'product', p_product,
    'before', jsonb_build_object('name', v_before.name, 'price_minor', v_before.price_minor, 'active', v_before.active),
    'after', jsonb_build_object('name', v_name, 'price_minor', p_price_minor, 'active', p_active)));
end;
$$;
revoke all on function public.platform_support_update_package(uuid, uuid, text, integer, boolean) from public, anon;
grant execute on function public.platform_support_update_package(uuid, uuid, text, integer, boolean) to authenticated;

-- Horario: próximos días con cupo y reservadas.
create or replace function public.platform_support_schedule(p_studio uuid, p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 31);
begin
  perform private.platform_require_support(p_studio, 'horario');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cs.id, 'starts_at', cs.starts_at, 'ends_at', cs.ends_at, 'status', cs.status::text,
      'class_name', coalesce(ct.name, 'Clase'), 'capacity', cs.capacity,
      'reserved', (select count(*) from public.reservations r where r.session_id = cs.id and r.status in ('reserved', 'attended'))
    ) order by cs.starts_at)
    from public.class_sessions cs
    left join public.class_templates ct on ct.id = cs.template_id
    where cs.studio_id = p_studio and cs.starts_at >= v_now - interval '2 hours'
      and cs.starts_at < v_now + make_interval(days => v_days)), '[]'::jsonb);
end;
$$;
revoke all on function public.platform_support_schedule(uuid, integer) from public, anon;
grant execute on function public.platform_support_schedule(uuid, integer) to authenticated;

-- Aviso al dueño: sesión abierta y últimas entradas de soporte (sin datos personales del admin).
create or replace function public.studio_support_access(p_studio uuid)
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
  return jsonb_build_object(
    'active', (
      select jsonb_build_object('reason', s.reason, 'started_at', s.started_at, 'expires_at', s.expires_at)
      from public.platform_support_sessions s
      where s.studio_id = p_studio and s.ended_at is null and s.expires_at > clock_timestamp()
      order by s.started_at desc limit 1),
    'recent', coalesce((
      select jsonb_agg(x order by x->>'started_at' desc) from (
        select jsonb_build_object(
          'reason', s.reason, 'started_at', s.started_at,
          'ended_at', coalesce(s.ended_at, least(s.expires_at, clock_timestamp())),
          'changes', (select count(*) from public.platform_audit_log a
            where a.studio_id = p_studio and a.action like 'support.%.update' and a.detail->>'session' = s.id::text)
        ) x
        from public.platform_support_sessions s
        where s.studio_id = p_studio
        order by s.started_at desc limit 10) q), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.studio_support_access(uuid) from public, anon;
grant execute on function public.studio_support_access(uuid) to authenticated;
