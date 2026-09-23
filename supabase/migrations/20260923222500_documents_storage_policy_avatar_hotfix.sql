-- Hotfix: keep DOCUMENTOS-01 storage authorization from breaking unrelated private buckets.
--
-- PostgreSQL may evaluate permissive storage policies without short-circuiting the bucket predicate.
-- The previous studio_documents_read policy called a private helper whose EXECUTE privilege is
-- intentionally revoked from authenticated users. That made profile-avatar reads/uploads fail
-- while Storage evaluated policies for storage.objects.
--
-- Expose one narrow SECURITY DEFINER predicate that only answers whether the current caller may
-- read the supplied studio-document object path. Do not expose the broader document helper.

create or replace function private.can_read_studio_document_object(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions dv
    where dv.file_path = p_path
      and (
        private.has_capability(dv.studio_id, 'documents.read')
        or exists (
          select 1
          from public.students s
          where s.studio_id = dv.studio_id
            and s.user_id = (select auth.uid())
            and private.is_current_student(s.id, s.studio_id)
            and private.document_version_applies_to_student(dv.id, s.id, null)
        )
      )
  );
$$;

revoke all on function private.can_read_studio_document_object(text)
from public, anon, authenticated, service_role;

grant execute on function private.can_read_studio_document_object(text)
to authenticated;

drop policy if exists "studio_documents_read" on storage.objects;

create policy "studio_documents_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'studio-documents'
  and private.can_read_studio_document_object(name)
);
