
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid null references auth.users(id) on delete set null
);

alter table public.platform_admins enable row level security;

revoke all on table public.platform_admins from public, anon, authenticated;
grant select on table public.platform_admins to authenticated;

drop policy if exists platform_admin_self_read on public.platform_admins;
create policy platform_admin_self_read
on public.platform_admins
for select
to authenticated
using (active = true and user_id = (select auth.uid()));

create or replace function public.studio_complete_password_activation()
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if not exists (
    select 1
    from public.studio_memberships sm
    where sm.user_id=v_user_id
      and sm.active=true
      and (
        (
          sm.role in ('owner','admin')
          and private.has_capability(sm.studio_id,'admin.portal')
        )
        or (
          sm.role='instructor'
          and private.has_capability(sm.studio_id,'instructor.portal')
        )
      )
  ) then
    raise exception 'studio_context_not_found';
  end if;

  update public.user_accounts
  set must_change_password=false,
      updated_at=now()
  where id=v_user_id
    and status='active';

  if not found then
    raise exception 'account_not_active';
  end if;
end;
$$;

revoke all on function public.studio_complete_password_activation() from public, anon;
grant execute on function public.studio_complete_password_activation() to authenticated;
