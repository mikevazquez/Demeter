-- Sandbox only. Protect capacity editing and cancellation with active holds.
create or replace function private.workshop_session_hold_capacity_gate()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_taken bigint;
begin
 if new.capacity is not distinct from old.capacity
   and new.status is not distinct from old.status then return new; end if;
 if not exists(select 1 from public.workshop_offer_sessions where session_id=old.id)
 then return new; end if;
 v_taken:=private.workshop_capacity_seats_taken(old.studio_id,old.id);
 if new.capacity<v_taken then raise exception 'capacity_below_reservations'; end if;
 if new.status::text='cancelled' and old.status::text<>'cancelled'
   and private.workshop_provisional_active_seats(old.studio_id,old.id)>0
 then raise exception 'provisional_holds_require_resolution'; end if;
 return new;
end $$;
drop trigger if exists workshop_session_hold_capacity_gate on public.class_sessions;
create trigger workshop_session_hold_capacity_gate before update of capacity,status
on public.class_sessions for each row
execute function private.workshop_session_hold_capacity_gate();
revoke all on function private.workshop_session_hold_capacity_gate()
from public,anon,authenticated,service_role;
