create or replace function public.guardian_document_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_hash text;
  v_invite public.guardian_document_invitations%rowtype;
  v_guardian public.student_guardians%rowtype;
  v_student public.students%rowtype;
  v_studio public.studios%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_row record;
begin
  if nullif(trim(coalesce(p_token,'')),'') is null then
    raise exception 'guardian_token_required';
  end if;

  v_hash := encode(digest(p_token,'sha256'),'hex');

  select * into v_invite
  from public.guardian_document_invitations
  where token_hash=v_hash;

  if not found then raise exception 'guardian_invitation_not_found'; end if;
  if v_invite.status='revoked' then raise exception 'guardian_invitation_revoked'; end if;
  if v_invite.expires_at<=now() then raise exception 'guardian_invitation_expired'; end if;

  select * into v_guardian
  from public.student_guardians
  where id=v_invite.guardian_id and active;

  select * into v_student
  from public.students
  where id=v_invite.student_id;

  select * into v_studio
  from public.studios
  where id=v_invite.studio_id
    and status='active';

  if v_guardian.id is null or v_student.id is null or v_studio.id is null then
    raise exception 'guardian_invitation_invalid';
  end if;

  for v_row in
    select dv.*,d.name as document_name,d.document_type,d.description
    from public.document_versions dv
    join public.studio_documents d on d.id=dv.document_id
    where dv.studio_id=v_invite.studio_id
      and dv.status in ('active','scheduled')
      and dv.published_at is not null
      and coalesce(dv.effective_at,dv.published_at)<=now()
      and dv.retired_at is null
      and dv.acceptance_party in ('guardian_if_minor','student_and_guardian','guardian_only')
      and private.document_version_applies_to_student(dv.id,v_student.id,null)
    order by d.name,dv.version_number desc
  loop
    if exists (
      select 1 from public.document_versions newer
      where newer.document_id=v_row.document_id
        and newer.version_number>v_row.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at,newer.published_at)<=now()
        and newer.retired_at is null
    ) then
      continue;
    end if;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'version_id',v_row.id,
        'document_id',v_row.document_id,
        'name',v_row.document_name,
        'document_type',v_row.document_type,
        'description',v_row.description,
        'version_number',v_row.version_number,
        'response_mode',v_row.response_mode,
        'effective_at',v_row.effective_at,
        'file_path',v_row.file_path,
        'file_name',v_row.file_name,
        'affirmation_text',v_row.affirmation_text,
        'guardian_completed',private.document_party_satisfied(v_row.id,v_student.id,'guardian'),
        'student_completed',private.document_party_satisfied(v_row.id,v_student.id,'student'),
        'satisfied',private.document_requirement_satisfied(v_row.id,v_student.id)
      )
    );
  end loop;

  return jsonb_build_object(
    'invitation_id',v_invite.id,
    'status',v_invite.status,
    'expires_at',v_invite.expires_at,
    'studio',jsonb_build_object(
      'id',v_studio.id,
      'name',v_studio.name,
      'tagline',v_studio.tagline,
      'timezone',v_studio.timezone,
      'locale',v_studio.locale,
      'primary_color',v_studio.primary_color,
      'logo_path',v_studio.logo_path
    ),
    'guardian',jsonb_build_object(
      'id',v_guardian.id,
      'full_name',v_guardian.full_name,
      'relationship',v_guardian.relationship,
      'relationship_detail',v_guardian.relationship_detail
    ),
    'student',jsonb_build_object(
      'id',v_student.id,
      'full_name',v_student.full_name
    ),
    'items',v_items
  );
end;
$$;
