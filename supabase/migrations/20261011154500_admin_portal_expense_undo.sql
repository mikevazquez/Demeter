alter table public.studio_expenses add column deleted_at timestamptz,add column deleted_by uuid references auth.users(id);
create index studio_expenses_deleted_by_idx on public.studio_expenses(deleted_by);
create or replace function private.portal_expense_date_guard() returns trigger language plpgsql set search_path='' as $$
declare today date;
begin
 select (now() at time zone timezone)::date into today from public.studios where id=new.studio_id;
 if new.effective_on>today then raise exception 'expense_future_date';end if;
 return new;
end $$;
create trigger portal_expense_date_guard before insert or update of effective_on on public.studio_expenses for each row execute function private.portal_expense_date_guard();
create or replace function public.admin_set_expense_deleted(p_expense_id uuid,p_deleted boolean)
returns void language plpgsql security definer set search_path='' as $$
declare expense public.studio_expenses%rowtype;
begin
 select * into expense from public.studio_expenses where id=p_expense_id for update;
 if not found or not private.has_capability(expense.studio_id,'reports.read') then raise exception 'forbidden';end if;
 if not p_deleted and (expense.deleted_at is null or expense.deleted_by is distinct from (select auth.uid()) or expense.deleted_at<now()-interval '5 minutes') then raise exception 'expense_undo_expired';end if;
 update public.studio_expenses set deleted_at=case when p_deleted then now() else null end,deleted_by=case when p_deleted then (select auth.uid()) else null end where id=expense.id;
end $$;
revoke all on function public.admin_set_expense_deleted(uuid,boolean) from public,anon;
grant execute on function public.admin_set_expense_deleted(uuid,boolean) to authenticated;
