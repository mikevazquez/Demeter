-- KIOSCO-01 · token hardening after session close.
-- Una sesión finalizada o cancelada invalida físicamente todas sus credenciales QR.

create or replace function private.revoke_cancelled_session_checkin_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status is distinct from new.status
     and new.status in ('cancelled', 'completed') then
    update public.reservation_checkin_tokens t
    set revoked_at = coalesce(t.revoked_at, now()),
        updated_at = now()
    from public.reservations r
    where r.id = t.reservation_id
      and r.session_id = new.id;
  end if;

  return new;
end;
$function$;

revoke all on function private.revoke_cancelled_session_checkin_tokens()
from public, anon, authenticated, service_role;
