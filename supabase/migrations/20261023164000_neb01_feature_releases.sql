-- NEB-01-20 · Lanzamientos: funciones por estudio (Sandbox → Beta → Todos).
-- Nada llega a todos los estudios sin el botón de Mike (Governance 2.0): pasar a «Todos» exige confirmar.
-- La base sabe si es Sandbox por public.platform_environment; sin renglón se trata como producción
-- (lo seguro: lo que está en etapa Sandbox no aparece). Codex inserta 'sandbox' en Sandbox.

create table if not exists public.platform_environment (
  singleton boolean primary key default true check (singleton),
  name text not null check (name in ('sandbox', 'production'))
);
alter table public.platform_environment enable row level security;
revoke all on table public.platform_environment from anon, authenticated;

create table if not exists public.platform_features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 400),
  stage text not null default 'sandbox' check (stage in ('sandbox', 'beta', 'all')),
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_feature_beta_studios (
  feature_key text not null references public.platform_features(key) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (feature_key, studio_id)
);

create table if not exists public.platform_feature_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  feature_key text not null references public.platform_features(key) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, studio_id, feature_key)
);

alter table public.platform_features enable row level security;
alter table public.platform_feature_beta_studios enable row level security;
alter table public.platform_feature_seen enable row level security;
revoke all on table public.platform_features, public.platform_feature_beta_studios, public.platform_feature_seen
  from anon, authenticated;

create or replace function private.platform_environment()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select name from public.platform_environment where singleton), 'production');
$$;
revoke all on function private.platform_environment() from public, anon, authenticated;

create or replace function private.studio_feature_enabled(p_studio uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_features f
    where f.key = p_key
      and (f.stage = 'all'
        or (f.stage = 'beta' and exists (
          select 1 from public.platform_feature_beta_studios b where b.feature_key = f.key and b.studio_id = p_studio))
        or (f.stage = 'sandbox' and private.platform_environment() = 'sandbox'))
  );
$$;
revoke all on function private.studio_feature_enabled(uuid, text) from public, anon, authenticated;

-- Para la app: qué funciones están encendidas en el estudio (no es dato sensible; pide sesión).
create or replace function public.studio_feature_flags(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;
  return coalesce((
    select jsonb_object_agg(f.key, true)
    from public.platform_features f
    where private.studio_feature_enabled(p_studio, f.key)), '{}'::jsonb);
end;
$$;
revoke all on function public.studio_feature_flags(uuid) from public, anon;
grant execute on function public.studio_feature_flags(uuid) to authenticated;

-- Novedades: funciones que llegaron al estudio en los últimos 30 días y que esta persona no ha cerrado.
create or replace function public.studio_feature_news(p_studio uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.studio_memberships m
    where m.studio_id = p_studio and m.user_id = (select auth.uid()) and m.active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', f.key, 'name', f.name, 'description', f.description)
      order by f.stage_changed_at desc)
    from public.platform_features f
    where f.stage in ('beta', 'all')
      and private.studio_feature_enabled(p_studio, f.key)
      and greatest(f.stage_changed_at, coalesce((select b.added_at from public.platform_feature_beta_studios b
            where b.feature_key = f.key and b.studio_id = p_studio), f.stage_changed_at)) > now() - interval '30 days'
      and not exists (select 1 from public.platform_feature_seen s
        where s.user_id = (select auth.uid()) and s.studio_id = p_studio and s.feature_key = f.key)), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_feature_news(uuid) from public, anon;
grant execute on function public.studio_feature_news(uuid) to authenticated;

create or replace function public.studio_dismiss_feature_news(p_studio uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.studio_memberships m
    where m.studio_id = p_studio and m.user_id = (select auth.uid()) and m.active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_features where key = p_key) then
    raise exception 'feature_not_found';
  end if;
  insert into public.platform_feature_seen (user_id, studio_id, feature_key)
  values ((select auth.uid()), p_studio, p_key)
  on conflict do nothing;
end;
$$;
revoke all on function public.studio_dismiss_feature_news(uuid, text) from public, anon;
grant execute on function public.studio_dismiss_feature_news(uuid, text) to authenticated;

-- Consola.
create or replace function public.platform_features_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_admin();
  return jsonb_build_object(
    'environment', private.platform_environment(),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', f.key, 'name', f.name, 'description', f.description, 'stage', f.stage,
        'stage_changed_at', f.stage_changed_at,
        'beta_studios', coalesce((select jsonb_agg(b.studio_id order by b.added_at)
          from public.platform_feature_beta_studios b where b.feature_key = f.key), '[]'::jsonb)
      ) order by f.created_at, f.key)
      from public.platform_features f), '[]'::jsonb));
end;
$$;
revoke all on function public.platform_features_list() from public, anon;
grant execute on function public.platform_features_list() to authenticated;

create or replace function public.platform_set_feature_stage(p_key text, p_stage text, p_confirm_all boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  perform private.platform_require_admin();
  if p_stage not in ('sandbox', 'beta', 'all') then
    raise exception 'feature_stage_invalid';
  end if;
  select stage into v_from from public.platform_features where key = p_key for update;
  if not found then
    raise exception 'feature_not_found';
  end if;
  if p_stage = 'all' and not coalesce(p_confirm_all, false) then
    raise exception 'feature_confirm_required';
  end if;
  if v_from = p_stage then
    return;
  end if;
  update public.platform_features set stage = p_stage, stage_changed_at = now() where key = p_key;
  perform private.platform_audit(null, 'feature.stage.set',
    jsonb_build_object('feature', p_key, 'from', v_from, 'to', p_stage));
end;
$$;
revoke all on function public.platform_set_feature_stage(text, text, boolean) from public, anon;
grant execute on function public.platform_set_feature_stage(text, text, boolean) to authenticated;

create or replace function public.platform_set_feature_beta_studio(p_key text, p_studio uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_admin();
  if not exists (select 1 from public.platform_features where key = p_key) then
    raise exception 'feature_not_found';
  end if;
  if not exists (select 1 from public.studios where id = p_studio) then
    raise exception 'studio_not_found';
  end if;
  if coalesce(p_on, false) then
    insert into public.platform_feature_beta_studios (feature_key, studio_id) values (p_key, p_studio)
    on conflict do nothing;
    if found then
      perform private.platform_audit(p_studio, 'feature.beta.on', jsonb_build_object('feature', p_key));
    end if;
  else
    delete from public.platform_feature_beta_studios where feature_key = p_key and studio_id = p_studio;
    if found then
      perform private.platform_audit(p_studio, 'feature.beta.off', jsonb_build_object('feature', p_key));
    end if;
  end if;
end;
$$;
revoke all on function public.platform_set_feature_beta_studio(text, uuid, boolean) from public, anon;
grant execute on function public.platform_set_feature_beta_studio(text, uuid, boolean) to authenticated;

-- Funciones de arranque: lo nuevo de NEB-01-18 y NEB-01-19 empieza en Sandbox.
insert into public.platform_features (key, name, description, stage) values
  ('config_review', 'Revisión de configuración',
   'Más › Revisión de configuración: lo que conviene corregir para vender y reservar sin trabas.', 'sandbox'),
  ('support_requests', 'Ayuda de Nébora',
   'Más › Ayuda de Nébora: pide soporte y consulta las respuestas en tu panel.', 'sandbox')
on conflict (key) do nothing;
