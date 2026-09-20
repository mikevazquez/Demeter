drop policy if exists "profiles_insert_self" on public.profiles;

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);
