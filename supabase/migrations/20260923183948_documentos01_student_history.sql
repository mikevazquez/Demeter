
-- DOCUMENTOS-01 · student document history and historical file access

create or replace function public.student_document_detail(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_row record;
  v_has_history boolean := false;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and s.active
    and s.lifecycle_status='active'
    and private.is_current_student(s.id,s.studio_id)
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  select exists (
    select 1
    from public.document_acceptances a
    where a.version_id=p_version_id
      and a.student_id=v_student.id
  ) into v_has_history;

  select
    dv.*,d.name as document_name,d.document_type,d.description,
    private.document_requirement_satisfied(dv.id,v_student.id) as satisfied,
    private.document_party_satisfied(dv.id,v_student.id,'student') as student_completed,
    private.document_party_satisfied(dv.id,v_student.id,'guardian') as guardian_completed,
    private.student_is_minor(v_student.id,current_date) as minor,
    v_has_history as historical_access
  into v_row
  from public.document_versions dv
  join public.studio_documents d on d.id=dv.document_id
  where dv.id=p_version_id
    and dv.studio_id=v_student.studio_id
    and dv.published_at is not null
    and (
      private.document_version_applies_to_student(dv.id,v_student.id,null)
      or v_has_history
    );

  if not found then raise exception 'document_version_not_found'; end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.student_document_detail(uuid)
from public, anon, authenticated;
grant execute on function public.student_document_detail(uuid)
to authenticated;

create or replace function public.student_document_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_row record;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and s.active
    and s.lifecycle_status='active'
    and private.is_current_student(s.id,s.studio_id)
  limit 1;

  if not found then raise exception 'student_context_not_found'; end if;

  for v_row in
    select
      a.id as acceptance_id,
      a.accepted_at,
      a.acceptor_kind,
      a.decision,
      a.method,
      a.guardian_id,
      dv.id as version_id,
      dv.document_id,
      dv.version_number,
      dv.file_name,
      dv.file_path,
      dv.content_sha256,
      d.name as document_name,
      d.document_type,
      g.full_name as guardian_name,
      g.relationship as guardian_relationship,
      i.reason as invalidation_reason,
      i.invalidated_at
    from public.document_acceptances a
    join public.document_versions dv on dv.id=a.version_id
    join public.studio_documents d on d.id=dv.document_id
    left join public.student_guardians g on g.id=a.guardian_id
    left join public.document_acceptance_invalidations i on i.acceptance_id=a.id
    where a.studio_id=v_student.studio_id
      and a.student_id=v_student.id
    order by a.accepted_at desc
  loop
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'acceptance_id',v_row.acceptance_id,
        'accepted_at',v_row.accepted_at,
        'acceptor_kind',v_row.acceptor_kind,
        'decision',v_row.decision,
        'method',v_row.method,
        'guardian_id',v_row.guardian_id,
        'guardian_name',v_row.guardian_name,
        'guardian_relationship',v_row.guardian_relationship,
        'version_id',v_row.version_id,
        'document_id',v_row.document_id,
        'version_number',v_row.version_number,
        'file_name',v_row.file_name,
        'file_path',v_row.file_path,
        'content_sha256',v_row.content_sha256,
        'document_name',v_row.document_name,
        'document_type',v_row.document_type,
        'invalidated',v_row.invalidated_at is not null,
        'invalidation_reason',v_row.invalidation_reason,
        'invalidated_at',v_row.invalidated_at
      )
    );
  end loop;

  return v_items;
end;
$$;

revoke all on function public.student_document_history()
from public, anon, authenticated;
grant execute on function public.student_document_history()
to authenticated;

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
            and (
              private.document_version_applies_to_student(dv.id,s.id,null)
              or exists (
                select 1
                from public.document_acceptances a
                where a.version_id=dv.id
                  and a.student_id=s.id
              )
            )
        )
      )
  )
);
