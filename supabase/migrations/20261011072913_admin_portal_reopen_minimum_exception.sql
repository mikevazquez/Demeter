create or replace function public.admin_reopen_session(p_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.class_sessions%rowtype;
begin
  select * into s from public.class_sessions where id=p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if (select auth.uid()) is null or not private.has_capability(s.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
  if s.status<>'cancelled' or s.starts_at<=now() then raise exception 'session_not_reopenable'; end if;
  if public.admin_session_has_conflict(s.studio_id,s.starts_at,s.ends_at,s.instructor_id,s.space_id,s.id) then raise exception 'conflict'; end if;
  update public.class_sessions set status='scheduled',is_schedule_exception=true,minimum_override_allowed=true,minimum_override=true,
    cancellation_note=null where id=s.id;
  -- Cancellation metadata is cleared by the existing audit trigger. No
  -- cancelled reservation or refunded credit is restored.
end;
$$;
revoke all on function public.admin_reopen_session(uuid) from public,anon;
grant execute on function public.admin_reopen_session(uuid) to authenticated;

