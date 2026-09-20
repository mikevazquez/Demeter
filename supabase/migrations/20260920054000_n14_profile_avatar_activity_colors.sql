alter table public.class_templates
  add column if not exists color_hex text not null default '#FF0A8A';

alter table public.class_templates
  drop constraint if exists class_templates_color_hex_check;

alter table public.class_templates
  add constraint class_templates_color_hex_check
  check (color_hex ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.class_templates.color_hex is
  'Configurable activity accent used by admin and student schedules.';

update public.class_templates
set color_hex = case lower(name)
  when 'twerk' then '#AE51BB'
  when 'pole fitness' then '#0877B9'
  when 'exotic pole' then '#D52473'
  when 'pole exotic' then '#D52473'
  when 'heels' then '#D1A340'
  when 'yoga' then '#AD9ACD'
  when 'espiral' then '#B2CC0B'
  when 'danza aérea' then '#07C0B3'
  when 'danza aerea' then '#07C0B3'
  else color_hex
end
where lower(name) in (
  'twerk',
  'pole fitness',
  'exotic pole',
  'pole exotic',
  'heels',
  'yoga',
  'espiral',
  'danza aérea',
  'danza aerea'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatars_select_own" on storage.objects;
create policy "profile_avatars_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_avatars_insert_own" on storage.objects;
create policy "profile_avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_avatars_update_own" on storage.objects;
create policy "profile_avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_avatars_delete_own" on storage.objects;
create policy "profile_avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
