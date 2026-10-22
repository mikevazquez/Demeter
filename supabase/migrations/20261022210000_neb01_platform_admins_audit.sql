-- NEB-01-01 · Nébora: administradores de plataforma y bitácora inmutable.
-- Decisiones de Mike (22-oct-2026): Mike administra todos los estudios desde la consola de Nébora;
-- todo lo que la plataforma lee o cambia de un estudio queda en bitácora y no se puede borrar.
-- Esta migración NO da de alta a ningún administrador: Codex inserta el user_id de Mike después
-- de aplicarla (Sandbox: su cuenta de pruebas; producción: solo con autorización de Mike).

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

create index if not exists platform_audit_log_studio_idx on public.platform_audit_log (studio_id, occurred_at desc);
create index if not exists platform_audit_log_actor_idx on public.platform_audit_log (actor_user_id, occurred_at desc);

-- La bitácora solo crece: ningún rol puede editar ni borrar renglones.
create or replace function private.platform_audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform_audit_immutable';
end;
$$;
revoke all on function private.platform_audit_immutable() from public, anon, authenticated;

drop trigger if exists platform_audit_log_immutable on public.platform_audit_log;
create trigger platform_audit_log_immutable
  before update or delete on public.platform_audit_log
  for each row execute function private.platform_audit_immutable();

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a
    where a.user_id = (select auth.uid()) and a.active
  );
$$;
revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

create or replace function private.platform_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;
  return auth.uid();
end;
$$;
revoke all on function private.platform_require_admin() from public, anon, authenticated;

create or replace function private.platform_audit(p_studio uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_audit_log (actor_user_id, studio_id, action, detail)
  values (auth.uid(), p_studio, p_action, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function private.platform_audit(uuid, text, jsonb) from public, anon, authenticated;

-- La app consulta si el usuario puede abrir la consola.
create or replace function public.platform_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin();
$$;
revoke all on function public.platform_is_admin() from public, anon;
grant execute on function public.platform_is_admin() to authenticated;

create or replace function public.platform_audit_list(p_studio uuid default null, p_limit integer default 100)
returns setof public.platform_audit_log
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.platform_require_admin();
  return query
    select l.* from public.platform_audit_log l
    where p_studio is null or l.studio_id = p_studio
    order by l.occurred_at desc, l.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke all on function public.platform_audit_list(uuid, integer) from public, anon;
grant execute on function public.platform_audit_list(uuid, integer) to authenticated;

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
alter table public.platform_audit_log enable row level security;
alter table public.platform_audit_log force row level security;

revoke all on public.platform_admins, public.platform_audit_log from public, anon, authenticated;
grant select on public.platform_admins, public.platform_audit_log to authenticated;

drop policy if exists platform_admins_read on public.platform_admins;
create policy platform_admins_read on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

drop policy if exists platform_audit_log_admin_read on public.platform_audit_log;
create policy platform_audit_log_admin_read on public.platform_audit_log
  for select to authenticated
  using (private.is_platform_admin());
