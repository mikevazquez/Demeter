drop policy if exists memberships_admin_delete on public.studio_memberships;
drop policy if exists memberships_admin_insert on public.studio_memberships;
drop policy if exists memberships_admin_update on public.studio_memberships;
drop policy if exists memberships_member_select on public.studio_memberships;

create policy memberships_select
on public.studio_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.has_capability(studio_id, 'settings.write')
);

create policy memberships_insert
on public.studio_memberships
for insert
to authenticated
with check (private.has_capability(studio_id, 'settings.write'));

create policy memberships_update
on public.studio_memberships
for update
to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));

create policy memberships_delete
on public.studio_memberships
for delete
to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists user_accounts_status_update on public.user_accounts;
create policy user_accounts_status_update
on public.user_accounts
for update
to authenticated
using (
  exists (
    select 1
    from public.studio_memberships m
    where m.user_id = user_accounts.id
      and private.has_capability(m.studio_id, 'settings.write')
  )
)
with check (
  exists (
    select 1
    from public.studio_memberships m
    where m.user_id = user_accounts.id
      and private.has_capability(m.studio_id, 'settings.write')
  )
);

revoke update on public.user_accounts from authenticated;
grant update(status) on public.user_accounts to authenticated;
