-- CLASS VISUALS · optional artwork for activities and specific sessions
--
-- Activity artwork is the default image for booking cards and class detail.
-- A session may optionally override it for a one-off workshop or special class.

alter table public.class_templates
  add column if not exists cover_image_path text;

alter table public.class_sessions
  add column if not exists cover_image_path text;

comment on column public.class_templates.cover_image_path is
  'Optional path in class-artwork storage used as the default student-facing activity image.';

comment on column public.class_sessions.cover_image_path is
  'Optional path in class-artwork storage that overrides the activity image for this session.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'class-artwork',
  'class-artwork',
  true,
  8388608,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "class_artwork_admin_insert" on storage.objects;
create policy "class_artwork_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'class-artwork'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and private.has_studio_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin']::public.studio_role[]
  )
);

drop policy if exists "class_artwork_admin_update" on storage.objects;
create policy "class_artwork_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'class-artwork'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and private.has_studio_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin']::public.studio_role[]
  )
)
with check (
  bucket_id = 'class-artwork'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and private.has_studio_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin']::public.studio_role[]
  )
);

drop policy if exists "class_artwork_admin_delete" on storage.objects;
create policy "class_artwork_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'class-artwork'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and private.has_studio_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner','admin']::public.studio_role[]
  )
);
