alter table public.studios
  add column if not exists logo_path text;

comment on column public.studios.logo_path is
  'Public studio logo object path inside the studio-branding storage bucket.';

alter table public.studios
  drop constraint if exists studios_logo_path_length_chk;

alter table public.studios
  add constraint studios_logo_path_length_chk
  check (logo_path is null or length(logo_path) <= 500);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'studio-branding',
  'studio-branding',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.is_current_user_studio_owner_path(p_studio_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_memberships sm
    where sm.studio_id::text = p_studio_text
      and sm.user_id = (select auth.uid())
      and sm.active = true
      and sm.role = 'owner'::public.studio_role
  );
$$;

drop policy if exists studio_branding_insert_owner on storage.objects;
create policy studio_branding_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'studio-branding'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
);

drop policy if exists studio_branding_update_owner on storage.objects;
create policy studio_branding_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'studio-branding'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
)
with check (
  bucket_id = 'studio-branding'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
);

drop policy if exists studio_branding_delete_owner on storage.objects;
create policy studio_branding_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'studio-branding'
  and private.is_current_user_studio_owner_path((storage.foldername(name))[1])
);

create or replace function public.get_public_studio_portal(p_slug text default null)
returns table (
  id uuid,
  name text,
  slug text,
  primary_color text,
  logo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.name,
    s.slug,
    s.primary_color,
    s.logo_path
  from public.studios s
  where s.status = 'active'::public.studio_status
    and (
      (
        p_slug is not null
        and s.slug = lower(trim(p_slug))
      )
      or (
        p_slug is null
        and 1 = (
          select count(*)
          from public.studios active_studio
          where active_studio.status = 'active'::public.studio_status
        )
      )
    )
  limit 1;
$$;

revoke all on function public.get_public_studio_portal(text) from public;
grant execute on function public.get_public_studio_portal(text) to anon, authenticated;

create or replace function public.owner_update_studio_portal_branding(
  p_studio_id uuid,
  p_name text,
  p_logo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_logo_path text := nullif(btrim(coalesce(p_logo_path, '')), '');
begin
  if not private.has_studio_role(
    p_studio_id,
    array['owner'::public.studio_role]
  ) then
    raise exception 'studio_owner_required' using errcode = '42501';
  end if;

  if length(normalized_name) < 2 or length(normalized_name) > 80 then
    raise exception 'studio_name_invalid' using errcode = '22023';
  end if;

  if normalized_logo_path is not null then
    if length(normalized_logo_path) > 500
       or split_part(normalized_logo_path, '/', 1) <> p_studio_id::text then
      raise exception 'studio_logo_path_invalid' using errcode = '22023';
    end if;
  end if;

  update public.studios
  set
    name = normalized_name,
    logo_path = normalized_logo_path
  where id = p_studio_id;
end;
$$;

revoke all on function public.owner_update_studio_portal_branding(uuid, text, text) from public;
grant execute on function public.owner_update_studio_portal_branding(uuid, text, text) to authenticated;
