
drop policy if exists class_template_resources_write
  on public.class_template_resources;

drop policy if exists class_template_resources_insert
  on public.class_template_resources;
create policy class_template_resources_insert
  on public.class_template_resources
  for insert
  to authenticated
  with check (private.has_capability(studio_id, 'schedule.write'));

drop policy if exists class_template_resources_update
  on public.class_template_resources;
create policy class_template_resources_update
  on public.class_template_resources
  for update
  to authenticated
  using (private.has_capability(studio_id, 'schedule.write'))
  with check (private.has_capability(studio_id, 'schedule.write'));

drop policy if exists class_template_resources_delete
  on public.class_template_resources;
create policy class_template_resources_delete
  on public.class_template_resources
  for delete
  to authenticated
  using (private.has_capability(studio_id, 'schedule.write'));
