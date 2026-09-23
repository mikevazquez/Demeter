
-- DOCUMENTOS-01 · person-centric document view for Student Profile 360

create or replace function public.admin_student_document_profile(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_minor boolean;
  v_current jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_guardians jsonb := '[]'::jsonb;
  v_invitations jsonb := '[]'::jsonb;
  v_row record;
  v_current_student_acceptance record;
  v_current_guardian_acceptance record;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_student
  from public.students
  where id=p_student_id;

  if not found then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'students.read') then raise exception 'forbidden'; end if;
  if not private.has_capability(v_student.studio_id,'documents.read') then raise exception 'forbidden'; end if;

  v_minor := private.student_is_minor(v_student.id,current_date);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',g.id,
      'full_name',g.full_name,
      'email',g.email,
      'phone',g.phone,
      'relationship',g.relationship,
      'relationship_detail',g.relationship_detail,
      'verified_at',g.verified_at,
      'active',g.active,
      'created_at',g.created_at
    )
    order by g.active desc,g.created_at desc
  ),'[]'::jsonb)
  into v_guardians
  from public.student_guardians g
  where g.studio_id=v_student.studio_id
    and g.student_id=v_student.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',i.id,
      'guardian_id',i.guardian_id,
      'status',i.status,
      'delivery_channel',i.delivery_channel,
      'destination_hint',i.destination_hint,
      'sent_at',i.sent_at,
      'expires_at',i.expires_at,
      'completed_at',i.completed_at,
      'revoked_at',i.revoked_at
    )
    order by i.sent_at desc
  ),'[]'::jsonb)
  into v_invitations
  from public.guardian_document_invitations i
  where i.studio_id=v_student.studio_id
    and i.student_id=v_student.id;

  for v_row in
    select dv.*,d.name as document_name,d.document_type,d.description
    from public.document_versions dv
    join public.studio_documents d on d.id=dv.document_id
    where dv.studio_id=v_student.studio_id
      and dv.status in ('active','scheduled')
      and dv.published_at is not null
      and coalesce(dv.effective_at,dv.published_at)<=now()
      and dv.retired_at is null
      and d.archived_at is null
    order by d.name,dv.version_number desc
  loop
    if exists (
      select 1
      from public.document_versions newer
      where newer.document_id=v_row.document_id
        and newer.version_number>v_row.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at,newer.published_at)<=now()
        and newer.retired_at is null
    ) then
      continue;
    end if;

    if not private.document_version_applies_to_student(v_row.id,v_student.id,null) then
      continue;
    end if;

    select a.id,a.accepted_at,a.decision,a.method
      into v_current_student_acceptance
    from public.document_acceptances a
    where a.version_id=v_row.id
      and a.student_id=v_student.id
      and a.acceptor_kind='student'
      and not exists (
        select 1 from public.document_acceptance_invalidations inv
        where inv.acceptance_id=a.id
      )
    order by a.accepted_at desc
    limit 1;

    select a.id,a.accepted_at,a.decision,a.method,a.guardian_id,g.full_name as guardian_name
      into v_current_guardian_acceptance
    from public.document_acceptances a
    left join public.student_guardians g on g.id=a.guardian_id
    where a.version_id=v_row.id
      and a.student_id=v_student.id
      and a.acceptor_kind='guardian'
      and not exists (
        select 1 from public.document_acceptance_invalidations inv
        where inv.acceptance_id=a.id
      )
    order by a.accepted_at desc
    limit 1;

    v_current := v_current || jsonb_build_array(
      jsonb_build_object(
        'document_id',v_row.document_id,
        'version_id',v_row.id,
        'name',v_row.document_name,
        'document_type',v_row.document_type,
        'description',v_row.description,
        'version_number',v_row.version_number,
        'response_mode',v_row.response_mode,
        'acceptance_party',v_row.acceptance_party,
        'audience_scope',v_row.audience_scope,
        'enforcement_scope',v_row.enforcement_scope,
        'requires_reacceptance',v_row.requires_reacceptance,
        'effective_at',v_row.effective_at,
        'file_path',v_row.file_path,
        'file_name',v_row.file_name,
        'satisfied',private.document_requirement_satisfied(v_row.id,v_student.id),
        'student_completed',private.document_party_satisfied(v_row.id,v_student.id,'student'),
        'guardian_completed',private.document_party_satisfied(v_row.id,v_student.id,'guardian'),
        'accepted_current_version_by_student',v_current_student_acceptance.id is not null,
        'accepted_current_version_by_guardian',v_current_guardian_acceptance.id is not null,
        'current_student_acceptance',case
          when v_current_student_acceptance.id is null then null
          else jsonb_build_object(
            'id',v_current_student_acceptance.id,
            'accepted_at',v_current_student_acceptance.accepted_at,
            'decision',v_current_student_acceptance.decision,
            'method',v_current_student_acceptance.method
          )
        end,
        'current_guardian_acceptance',case
          when v_current_guardian_acceptance.id is null then null
          else jsonb_build_object(
            'id',v_current_guardian_acceptance.id,
            'accepted_at',v_current_guardian_acceptance.accepted_at,
            'decision',v_current_guardian_acceptance.decision,
            'method',v_current_guardian_acceptance.method,
            'guardian_id',v_current_guardian_acceptance.guardian_id,
            'guardian_name',v_current_guardian_acceptance.guardian_name
          )
        end,
        'blocks_new_booking',
          v_row.enforcement_scope='global_booking'
          and not private.document_requirement_satisfied(v_row.id,v_student.id)
      )
    );

    v_current_student_acceptance := null;
    v_current_guardian_acceptance := null;
  end loop;

  for v_row in
    select
      a.id as acceptance_id,
      a.accepted_at,
      a.acceptor_kind,
      a.decision,
      a.method,
      a.guardian_id,
      a.affirmation_text,
      a.evidence,
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
      inv.reason as invalidation_reason,
      inv.invalidated_at
    from public.document_acceptances a
    join public.document_versions dv on dv.id=a.version_id
    join public.studio_documents d on d.id=dv.document_id
    left join public.student_guardians g on g.id=a.guardian_id
    left join public.document_acceptance_invalidations inv on inv.acceptance_id=a.id
    where a.studio_id=v_student.studio_id
      and a.student_id=v_student.id
    order by a.accepted_at desc
  loop
    v_history := v_history || jsonb_build_array(
      jsonb_build_object(
        'acceptance_id',v_row.acceptance_id,
        'accepted_at',v_row.accepted_at,
        'acceptor_kind',v_row.acceptor_kind,
        'decision',v_row.decision,
        'method',v_row.method,
        'guardian_id',v_row.guardian_id,
        'guardian_name',v_row.guardian_name,
        'guardian_relationship',v_row.guardian_relationship,
        'affirmation_text',v_row.affirmation_text,
        'evidence',v_row.evidence,
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

  return jsonb_build_object(
    'student_id',v_student.id,
    'is_minor',v_minor,
    'current',v_current,
    'history',v_history,
    'guardians',v_guardians,
    'invitations',v_invitations,
    'booking_blockers',private.student_booking_blockers(v_student.id,null)
  );
end;
$$;

revoke all on function public.admin_student_document_profile(uuid)
from public, anon, authenticated;
grant execute on function public.admin_student_document_profile(uuid)
to authenticated;
