create or replace function public.acquisition_credit_balance(target_acquisition_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cl.quantity), 0)::integer
  from public.credit_ledger cl
  join public.product_acquisitions pa on pa.id = cl.acquisition_id
  where cl.acquisition_id = target_acquisition_id
    and (
      private.has_capability(pa.studio_id, 'schedule.read')
      or private.has_capability(pa.studio_id, 'students.read')
      or exists (
        select 1
        from public.students s
        where s.id = pa.student_id
          and s.user_id = (select auth.uid())
          and private.has_capability(pa.studio_id, 'student.profile.self')
      )
    );
$$;

create or replace function public.admin_cancel_reservation(target_reservation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_status public.reservation_status;
begin
  select status into v_status
  from public.reservations
  where id = target_reservation_id;

  if v_status in ('cancelled_on_time', 'cancelled_late', 'cancelled_by_studio') then
    return;
  end if;

  v_result := public.cancel_reservation(target_reservation_id, null);
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception '%', coalesce(v_result->>'reason_code', 'cancel_failed');
  end if;
end;
$$;

revoke all on function public.acquisition_credit_balance(uuid) from public, anon;
grant execute on function public.acquisition_credit_balance(uuid) to authenticated;
revoke all on function public.admin_cancel_reservation(uuid) from public, anon;
grant execute on function public.admin_cancel_reservation(uuid) to authenticated;
