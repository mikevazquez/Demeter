-- NEB-01-02 · Nébora: planes, módulos y derechos por estudio.
-- Decisiones de Mike (22-oct-2026), precios en MXN con IVA incluido:
--  * Core $899/mes (configuración $1,500), Growth $1,399 ($2,500) con Recompensas y Recursos,
--    Pro $1,999 ($3,500) con todo y marca completa. Módulo suelto $299/mes.
--  * Founding: $899/mes 12 meses con todo excepto Demi, sin configuración, máximo 5 estudios;
--    después 30 % de descuento para siempre mientras siga activo.
--  * All Access: plan interno (Demeter), no se vende, todo incluido y sin cobro.
--  * Demi: configuración $2,999 + cuota mensual (precio pendiente de la medición NEB-01-21).
--  * Impago: 7 días de gracia y después solo lectura. Sin periodo de prueba.
-- Todo estudio que ya existe queda en All Access/interno: nada cambia para Demeter ni para los
-- estudios de prueba. Los estudios nuevos nacen igual hasta que la consola les asigna su plan.

create table if not exists public.platform_modules (
  key text primary key check (key in ('recompensas', 'recursos', 'catalogo', 'demi')),
  label text not null,
  monthly_price_mxn integer check (monthly_price_mxn is null or monthly_price_mxn >= 0),
  setup_price_mxn integer check (setup_price_mxn is null or setup_price_mxn >= 0),
  sort_order smallint not null
);

insert into public.platform_modules (key, label, monthly_price_mxn, setup_price_mxn, sort_order) values
  ('recompensas', 'Recompensas', 299, null, 1),
  ('recursos', 'Recursos y mapa', 299, null, 2),
  ('catalogo', 'Catálogo y evaluaciones', 299, null, 3),
  ('demi', 'Demi · WhatsApp con IA', null, 2999, 4)
on conflict (key) do update set
  label = excluded.label, monthly_price_mxn = excluded.monthly_price_mxn,
  setup_price_mxn = excluded.setup_price_mxn, sort_order = excluded.sort_order;

create table if not exists public.platform_plans (
  key text primary key check (key in ('core', 'growth', 'pro', 'founding', 'allaccess')),
  label text not null,
  monthly_price_mxn integer not null check (monthly_price_mxn >= 0),
  setup_price_mxn integer not null check (setup_price_mxn >= 0),
  included_modules text[] not null default '{}',
  brand_level text not null check (brand_level in ('powered', 'full')),
  sellable boolean not null,
  sort_order smallint not null
);

insert into public.platform_plans (key, label, monthly_price_mxn, setup_price_mxn, included_modules, brand_level, sellable, sort_order) values
  ('core', 'Core', 899, 1500, '{}', 'powered', true, 1),
  ('growth', 'Growth', 1399, 2500, '{recompensas,recursos}', 'powered', true, 2),
  ('pro', 'Pro', 1999, 3500, '{recompensas,recursos,catalogo}', 'full', true, 3),
  ('founding', 'Founding', 899, 0, '{recompensas,recursos,catalogo}', 'full', true, 4),
  ('allaccess', 'All Access', 0, 0, '{recompensas,recursos,catalogo,demi}', 'full', false, 5)
on conflict (key) do update set
  label = excluded.label, monthly_price_mxn = excluded.monthly_price_mxn,
  setup_price_mxn = excluded.setup_price_mxn, included_modules = excluded.included_modules,
  brand_level = excluded.brand_level, sellable = excluded.sellable, sort_order = excluded.sort_order;

create table if not exists public.platform_settings (
  key text primary key check (key in ('founding_seats', 'founding_months', 'founding_discount_pct', 'grace_days')),
  value integer not null check (value >= 0)
);

insert into public.platform_settings (key, value) values
  ('founding_seats', 5), ('founding_months', 12), ('founding_discount_pct', 30), ('grace_days', 7)
on conflict (key) do nothing;

create table if not exists public.studio_subscriptions (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  plan_key text not null references public.platform_plans(key),
  status text not null check (status in ('invited', 'active', 'grace', 'read_only', 'suspended', 'internal')),
  founding_started_on date,
  founding_alumni boolean not null default false,
  cut_day smallint check (cut_day between 1 and 28),
  grace_started_at timestamptz,
  status_changed_at timestamptz not null default now(),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- All Access solo puede estar interno o suspendido; los demás planes nunca son internos.
  constraint studio_subscriptions_internal_plan check (
    (plan_key = 'allaccess' and status in ('internal', 'suspended'))
    or (plan_key <> 'allaccess' and status <> 'internal')
  ),
  constraint studio_subscriptions_grace_start check (status <> 'grace' or grace_started_at is not null),
  constraint studio_subscriptions_founding_start check (plan_key <> 'founding' or founding_started_on is not null)
);

create table if not exists public.studio_module_addons (
  studio_id uuid not null references public.studios(id) on delete cascade,
  module_key text not null references public.platform_modules(key),
  active boolean not null default true,
  activated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  primary key (studio_id, module_key),
  check (active = (deactivated_at is null))
);

-- Cada estudio nuevo nace con suscripción interna; la consola (NEB-01-14) le asigna su plan.
create or replace function private.neb_studio_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.studio_subscriptions (studio_id, plan_key, status)
  values (new.id, 'allaccess', 'internal')
  on conflict (studio_id) do nothing;
  return new;
end;
$$;
revoke all on function private.neb_studio_default_subscription() from public, anon, authenticated;

drop trigger if exists neb_studio_default_subscription on public.studios;
create trigger neb_studio_default_subscription
  after insert on public.studios
  for each row execute function private.neb_studio_default_subscription();

insert into public.studio_subscriptions (studio_id, plan_key, status)
select s.id, 'allaccess', 'internal' from public.studios s
on conflict (studio_id) do nothing;

create or replace function private.platform_setting(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.platform_settings where key = p_key;
$$;
revoke all on function private.platform_setting(text) from public, anon, authenticated;

-- ¿El estudio tiene este módulo? Incluido en su plan o contratado aparte. Suspendido = nada.
create or replace function private.studio_has_module(p_studio uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.status <> 'suspended' and (
      p_module = any(p.included_modules)
      or exists (
        select 1 from public.studio_module_addons a
        where a.studio_id = s.studio_id and a.module_key = p_module and a.active
      )
    )
    from public.studio_subscriptions s
    join public.platform_plans p on p.key = s.plan_key
    where s.studio_id = p_studio
  ), false);
$$;
revoke all on function private.studio_has_module(uuid, text) from public, anon;
grant execute on function private.studio_has_module(uuid, text) to authenticated;

-- ¿El estudio puede vender y reservar? Solo lectura y suspendido no.
create or replace function private.studio_can_operate(p_studio uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.status in ('invited', 'active', 'grace', 'internal')
    from public.studio_subscriptions s where s.studio_id = p_studio
  ), false);
$$;
revoke all on function private.studio_can_operate(uuid) from public, anon;
grant execute on function private.studio_can_operate(uuid) to authenticated;

-- Mensualidad que el estudio paga a Nébora (sin la cuota de Demi, pendiente de precio).
create or replace function private.studio_monthly_price_mxn(p_studio uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select sub.*, p.monthly_price_mxn as plan_price, p.included_modules
    from public.studio_subscriptions sub
    join public.platform_plans p on p.key = sub.plan_key
    where sub.studio_id = p_studio
  ), extras as (
    select coalesce(sum(m.monthly_price_mxn), 0) as total
    from s
    join public.studio_module_addons a on a.studio_id = s.studio_id and a.active
    join public.platform_modules m on m.key = a.module_key
    where m.monthly_price_mxn is not null and not (a.module_key = any(s.included_modules))
  )
  select case
    when s.plan_key = 'allaccess' then 0
    when s.plan_key = 'founding' then s.plan_price
    when s.founding_alumni then
      round((s.plan_price + extras.total) * (100 - private.platform_setting('founding_discount_pct')) / 100.0)::integer
    else s.plan_price + extras.total
  end
  from s, extras;
$$;
revoke all on function private.studio_monthly_price_mxn(uuid) from public, anon, authenticated;

create or replace function private.studio_entitlements(p_studio uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'studio_id', s.studio_id,
    'plan', s.plan_key,
    'plan_label', p.label,
    'status', s.status,
    'brand_level', p.brand_level,
    'can_operate', private.studio_can_operate(s.studio_id),
    'monthly_price_mxn', private.studio_monthly_price_mxn(s.studio_id),
    'founding_alumni', s.founding_alumni,
    'founding_started_on', s.founding_started_on,
    'founding_ends_on', case when s.founding_started_on is null then null
      else (s.founding_started_on + make_interval(months => private.platform_setting('founding_months')))::date end,
    'cut_day', s.cut_day,
    'modules', (
      select jsonb_object_agg(m.key, private.studio_has_module(s.studio_id, m.key) order by m.sort_order)
      from public.platform_modules m
    )
  )
  from public.studio_subscriptions s
  join public.platform_plans p on p.key = s.plan_key
  where s.studio_id = p_studio;
$$;
revoke all on function private.studio_entitlements(uuid) from public, anon, authenticated;

-- Lectura para el propio estudio (cualquier miembro activo) o para la plataforma.
create or replace function public.studio_entitlements(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() and not exists (
    select 1 from public.studio_memberships m
    where m.studio_id = p_studio and m.user_id = (select auth.uid()) and m.active
  ) then
    raise exception 'forbidden';
  end if;
  return private.studio_entitlements(p_studio);
end;
$$;
revoke all on function public.studio_entitlements(uuid) from public, anon;
grant execute on function public.studio_entitlements(uuid) to authenticated;

-- Escrituras: solo la plataforma, siempre con bitácora.
create or replace function public.platform_set_studio_plan(p_studio uuid, p_plan text, p_cut_day smallint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.studio_subscriptions;
  v_status text;
begin
  perform private.platform_require_admin();
  select * into v_sub from public.studio_subscriptions where studio_id = p_studio for update;
  if v_sub.studio_id is null then raise exception 'studio_not_found'; end if;
  if not exists (select 1 from public.platform_plans where key = p_plan) then raise exception 'plan_invalid'; end if;

  if p_plan = 'founding' and v_sub.plan_key <> 'founding' and (
    select count(*) from public.studio_subscriptions where plan_key = 'founding'
  ) >= private.platform_setting('founding_seats') then
    raise exception 'founding_seats_full';
  end if;

  v_status := case
    when p_plan = 'allaccess' then 'internal'
    when v_sub.status = 'internal' then 'active'
    else v_sub.status
  end;

  update public.studio_subscriptions set
    plan_key = p_plan,
    status = v_status,
    founding_started_on = case
      when p_plan = 'founding' and v_sub.plan_key <> 'founding' then current_date
      when p_plan = 'founding' then v_sub.founding_started_on
      else v_sub.founding_started_on end,
    founding_alumni = case
      when p_plan = 'founding' then false
      when v_sub.plan_key = 'founding' and p_plan <> 'allaccess' then true
      else v_sub.founding_alumni end,
    cut_day = coalesce(p_cut_day, v_sub.cut_day),
    grace_started_at = case when v_status = 'grace' then v_sub.grace_started_at else null end,
    status_changed_at = case when v_status <> v_sub.status then now() else v_sub.status_changed_at end,
    updated_at = now()
  where studio_id = p_studio;

  perform private.platform_audit(p_studio, 'studio.plan.set',
    jsonb_build_object('from', v_sub.plan_key, 'to', p_plan, 'status', v_status));
  return private.studio_entitlements(p_studio);
end;
$$;
revoke all on function public.platform_set_studio_plan(uuid, text, smallint) from public, anon;
grant execute on function public.platform_set_studio_plan(uuid, text, smallint) to authenticated;

create or replace function public.platform_set_studio_module(p_studio uuid, p_module text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_admin();
  if not exists (select 1 from public.studio_subscriptions where studio_id = p_studio) then raise exception 'studio_not_found'; end if;
  if not exists (select 1 from public.platform_modules where key = p_module) then raise exception 'module_invalid'; end if;

  insert into public.studio_module_addons (studio_id, module_key, active, activated_at, deactivated_at)
  values (p_studio, p_module, p_active, now(), case when p_active then null else now() end)
  on conflict (studio_id, module_key) do update set
    active = excluded.active,
    activated_at = case when excluded.active and not public.studio_module_addons.active then now() else public.studio_module_addons.activated_at end,
    deactivated_at = case when excluded.active then null else now() end;

  perform private.platform_audit(p_studio, case when p_active then 'studio.module.on' else 'studio.module.off' end,
    jsonb_build_object('module', p_module));
  return private.studio_entitlements(p_studio);
end;
$$;
revoke all on function public.platform_set_studio_module(uuid, text, boolean) from public, anon;
grant execute on function public.platform_set_studio_module(uuid, text, boolean) to authenticated;

create or replace function public.platform_set_studio_status(p_studio uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.studio_subscriptions;
begin
  perform private.platform_require_admin();
  select * into v_sub from public.studio_subscriptions where studio_id = p_studio for update;
  if v_sub.studio_id is null then raise exception 'studio_not_found'; end if;
  if p_status not in ('invited', 'active', 'grace', 'read_only', 'suspended') then raise exception 'status_invalid'; end if;
  if v_sub.plan_key = 'allaccess' and p_status <> 'suspended' then raise exception 'status_invalid'; end if;

  update public.studio_subscriptions set
    status = p_status,
    grace_started_at = case when p_status = 'grace' then coalesce(v_sub.grace_started_at, now()) else null end,
    status_changed_at = now(),
    updated_at = now()
  where studio_id = p_studio;

  perform private.platform_audit(p_studio, 'studio.status.set',
    jsonb_build_object('from', v_sub.status, 'to', p_status));
  return private.studio_entitlements(p_studio);
end;
$$;
revoke all on function public.platform_set_studio_status(uuid, text) from public, anon;
grant execute on function public.platform_set_studio_status(uuid, text) to authenticated;

-- All Access suspendido se reactiva con platform_set_studio_plan(studio, 'allaccess'),
-- que lo regresa a 'internal'.

alter table public.platform_modules enable row level security;
alter table public.platform_plans enable row level security;
alter table public.platform_settings enable row level security;
alter table public.studio_subscriptions enable row level security;
alter table public.studio_subscriptions force row level security;
alter table public.studio_module_addons enable row level security;
alter table public.studio_module_addons force row level security;

revoke all on public.platform_modules, public.platform_plans, public.platform_settings,
  public.studio_subscriptions, public.studio_module_addons from public, anon, authenticated;
grant select on public.platform_modules, public.platform_plans, public.platform_settings,
  public.studio_subscriptions, public.studio_module_addons to authenticated;

drop policy if exists platform_modules_read on public.platform_modules;
create policy platform_modules_read on public.platform_modules for select to authenticated using (true);
drop policy if exists platform_plans_read on public.platform_plans;
create policy platform_plans_read on public.platform_plans for select to authenticated using (true);
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select to authenticated using (private.is_platform_admin());

drop policy if exists studio_subscriptions_read on public.studio_subscriptions;
create policy studio_subscriptions_read on public.studio_subscriptions for select to authenticated
  using (private.is_platform_admin() or private.has_capability(studio_id, 'settings.write'));
drop policy if exists studio_module_addons_read on public.studio_module_addons;
create policy studio_module_addons_read on public.studio_module_addons for select to authenticated
  using (private.is_platform_admin() or private.has_capability(studio_id, 'settings.write'));
