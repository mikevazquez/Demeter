drop policy if exists resource_types_write on public.resource_types;
create policy resource_types_insert on public.resource_types
for insert to authenticated
with check (private.has_capability(studio_id, 'settings.write'));
create policy resource_types_update on public.resource_types
for update to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));
create policy resource_types_delete on public.resource_types
for delete to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists resources_write on public.resources;
create policy resources_insert on public.resources
for insert to authenticated
with check (private.has_capability(studio_id, 'settings.write'));
create policy resources_update on public.resources
for update to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));
create policy resources_delete on public.resources
for delete to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists space_maps_write on public.space_maps;
create policy space_maps_insert on public.space_maps
for insert to authenticated
with check (private.has_capability(studio_id, 'settings.write'));
create policy space_maps_update on public.space_maps
for update to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));
create policy space_maps_delete on public.space_maps
for delete to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists space_map_elements_write on public.space_map_elements;
create policy space_map_elements_insert on public.space_map_elements
for insert to authenticated
with check (private.has_capability(studio_id, 'settings.write'));
create policy space_map_elements_update on public.space_map_elements
for update to authenticated
using (private.has_capability(studio_id, 'settings.write'))
with check (private.has_capability(studio_id, 'settings.write'));
create policy space_map_elements_delete on public.space_map_elements
for delete to authenticated
using (private.has_capability(studio_id, 'settings.write'));

drop policy if exists session_resources_write on public.session_resources;
create policy session_resources_insert on public.session_resources
for insert to authenticated
with check (private.has_capability(studio_id, 'schedule.write'));
create policy session_resources_update on public.session_resources
for update to authenticated
using (private.has_capability(studio_id, 'schedule.write'))
with check (private.has_capability(studio_id, 'schedule.write'));
create policy session_resources_delete on public.session_resources
for delete to authenticated
using (private.has_capability(studio_id, 'schedule.write'));

drop policy if exists resource_assignments_write on public.reservation_resource_assignments;
create policy resource_assignments_insert on public.reservation_resource_assignments
for insert to authenticated
with check (private.has_capability(studio_id, 'schedule.write'));
create policy resource_assignments_update on public.reservation_resource_assignments
for update to authenticated
using (private.has_capability(studio_id, 'schedule.write'))
with check (private.has_capability(studio_id, 'schedule.write'));
create policy resource_assignments_delete on public.reservation_resource_assignments
for delete to authenticated
using (private.has_capability(studio_id, 'schedule.write'));
