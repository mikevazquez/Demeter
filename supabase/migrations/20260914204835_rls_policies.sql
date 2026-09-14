revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy profiles_select_self on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_self on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy studios_member_select on public.studios for select to authenticated
  using ((select private.is_studio_member(id)));

create policy memberships_member_select on public.studio_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin']::public.studio_role[]))
  );

create policy disciplines_member_select on public.disciplines for select to authenticated
  using ((select private.is_studio_member(studio_id)));

create policy templates_member_select on public.class_templates for select to authenticated
  using ((select private.is_studio_member(studio_id)));

create policy sessions_member_select on public.class_sessions for select to authenticated
  using ((select private.is_studio_member(studio_id)));

create policy packages_member_select on public.packages for select to authenticated
  using ((select private.is_studio_member(studio_id)));

create policy student_packages_select on public.student_packages for select to authenticated
  using (
    student_user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin','coach']::public.studio_role[]))
  );

create policy reservations_select on public.reservations for select to authenticated
  using (
    student_user_id = (select auth.uid())
    or (select private.has_studio_role(studio_id, array['owner','admin','coach']::public.studio_role[]))
  );
