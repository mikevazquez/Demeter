create or replace function public.admin_book_student(target_session_id uuid, target_student_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.book_student(target_session_id, target_student_id);
  if not coalesce((v_result->>'eligible')::boolean, false) then
    raise exception '%', coalesce(v_result->>'reason_code', 'booking_failed');
  end if;
  return (v_result->>'reservation_id')::uuid;
end;
$$;

create or replace function public.admin_cancel_reservation(target_reservation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.cancel_reservation(target_reservation_id, null);
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception '%', coalesce(v_result->>'reason_code', 'cancel_failed');
  end if;
end;
$$;

create or replace function public.handle_session_cancelled_reservations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    perform public.cancel_session_reservations(new.id, 'Clase cancelada por el estudio');
  end if;
  return new;
end;
$$;

drop trigger if exists class_session_cancel_reservations on public.class_sessions;
create trigger class_session_cancel_reservations
after update of status on public.class_sessions
for each row
execute function public.handle_session_cancelled_reservations();

revoke all on function public.admin_book_student(uuid, uuid) from public, anon;
revoke all on function public.admin_cancel_reservation(uuid) from public, anon;
grant execute on function public.admin_book_student(uuid, uuid) to authenticated;
grant execute on function public.admin_cancel_reservation(uuid) to authenticated;
