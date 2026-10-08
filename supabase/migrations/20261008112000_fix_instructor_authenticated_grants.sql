-- Equipo: restore authenticated table privileges required by the existing
-- studio-scoped RLS policies. Do not grant any access to anon.
-- Without these grants PostgREST returns permission denied before evaluating RLS,
-- leaving the Equipo list empty and admin_create_instructor unable to insert.
grant select, insert, update on table public.instructors to authenticated;
grant select, insert, update, delete on table public.instructor_disciplines to authenticated;
