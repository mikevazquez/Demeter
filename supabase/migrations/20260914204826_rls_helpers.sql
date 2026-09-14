alter table public.profiles enable row level security;
alter table public.studios enable row level security;
alter table public.studio_memberships enable row level security;
alter table public.disciplines enable row level security;
alter table public.class_templates enable row level security;
alter table public.class_sessions enable row level security;
alter table public.packages enable row level security;
alter table public.student_packages enable row level security;
alter table public.reservations enable row level security;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_studio_member(target_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = target_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active
  );
$$;

create or replace function private.has_studio_role(target_studio_id uuid, allowed_roles public.studio_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id = target_studio_id
      and sm.user_id = (select auth.uid())
      and sm.active
      and sm.role = any(allowed_roles)
  );
$$;

revoke execute on function private.is_studio_member(uuid) from public, anon;
revoke execute on function private.has_studio_role(uuid, public.studio_role[]) from public, anon;
grant execute on function private.is_studio_member(uuid) to authenticated;
grant execute on function private.has_studio_role(uuid, public.studio_role[]) to authenticated;
