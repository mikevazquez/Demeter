drop policy if exists studio_expenses_read on public.studio_expenses;
create policy studio_expenses_read on public.studio_expenses for select to authenticated using(private.has_capability(studio_id,'reports.read'));
drop policy if exists studio_expenses_insert on public.studio_expenses;
create policy studio_expenses_insert on public.studio_expenses for insert to authenticated with check(private.has_capability(studio_id,'reports.read') and created_by=(select auth.uid()));
drop policy if exists studio_expenses_update on public.studio_expenses;
create policy studio_expenses_update on public.studio_expenses for update to authenticated using(private.has_capability(studio_id,'reports.read')) with check(private.has_capability(studio_id,'reports.read'));
drop policy if exists studio_expenses_delete on public.studio_expenses;
create policy studio_expenses_delete on public.studio_expenses for delete to authenticated using(private.has_capability(studio_id,'reports.read'));
