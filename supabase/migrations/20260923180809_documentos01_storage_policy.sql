
-- DOCUMENTOS-01 · private document storage read policy
drop policy if exists "studio_documents_read" on storage.objects;
create policy "studio_documents_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'studio-documents'
  and exists (
    select 1
    from public.document_versions dv
    where dv.file_path = name
      and (
        private.has_capability(dv.studio_id,'documents.read')
        or exists (
          select 1
          from public.students s
          where s.studio_id = dv.studio_id
            and s.user_id = (select auth.uid())
            and private.is_current_student(s.id,s.studio_id)
            and private.document_version_applies_to_student(dv.id,s.id,null)
        )
      )
  )
);
