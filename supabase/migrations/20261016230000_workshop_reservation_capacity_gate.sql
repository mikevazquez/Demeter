-- Sandbox-only migration. Enforces workshop capacity across all reservation writers.
create or replace function private.workshop_reservation_capacity_gate()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_capacity integer; v_occupied bigint;
begin
 if new.status::text not in ('reserved','attended') then return new; end if;
 if tg_op='UPDATE' and old.session_id is not distinct from new.session_id
    and old.studio_id is not distinct from new.studio_id
    and old.status::text in ('reserved','attended') then return new; end if;
 if not exists(select 1 from public.workshop_offer_sessions
               where session_id=new.session_id) then return new; end if;
 select s.capacity into v_capacity from public.class_sessions s
 where s.id=new.session_id and s.studio_id=new.studio_id for update;
 if not found then raise exception 'session_unavailable'; end if;
 select count(*) into v_occupied from public.reservations r
 where r.session_id=new.session_id and r.studio_id=new.studio_id
 and r.status::text in ('reserved','attended')
 and r.id is distinct from new.id;
 if v_occupied + private.workshop_provisional_active_seats(new.studio_id,new.session_id) >= v_capacity
 then raise exception 'session_full'; end if;
 return new;
end $$;
drop trigger if exists workshop_reservation_capacity_gate on public.reservations;
create trigger workshop_reservation_capacity_gate
before insert or update of session_id,studio_id,status on public.reservations
for each row execute function private.workshop_reservation_capacity_gate();
revoke all on function private.workshop_reservation_capacity_gate() from public,anon,authenticated,service_role;
