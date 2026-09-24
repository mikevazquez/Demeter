-- PROFILE AVATAR HOTFIX · isolate studio-document storage authorization
--
-- DOCUMENTOS-01 added a SELECT policy on storage.objects that invoked
-- private.document_version_applies_to_student directly. That helper is
-- intentionally not executable by authenticated users, so PostgreSQL could
-- raise a permission error while evaluating unrelated storage reads/writes
-- (including profile-avatars).
--
-- Keep private helpers private and expose one narrow SECURITY DEFINER guard
-- that authorizes only the current user against a concrete document object.

create or replace function public.can_read_studio_document_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions dv
    where dv.file_path = p_object_name
      and (
        private.has_capability(dv.studio_id,'documents.read')
        or exists (
          select 1
          from public.students s
          where s.studio_id = dv.studio_id
            and s.user_id = (select auth.uid())
            and private.is_current_student(s.id,s.studio_id)
            and (
              private.document_version_applies_to_student(dv.id,s.id,null)
              or exists (
                select 1
                from public.document_acceptances a
                where a.version_id = dv.id
                  and a.student_id = s.id
              )
            )
        )
      )
  );
$$;

revoke all on function public.can_read_studio_document_object(text)
from public, anon, authenticated;

grant execute on function public.can_read_studio_document_object(text)
to authenticated;

drop policy if exists "studio_documents_read" on storage.objects;
create policy "studio_documents_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'studio-documents'
  and public.can_read_studio_document_object(name)
);
