
-- DOCUMENTOS-01 · optional consent decision timeline + document booking exceptions

drop index if exists public.document_acceptances_identity_idx;

create index if not exists document_acceptances_identity_idx
on public.document_acceptances (
  version_id,
  student_id,
  acceptor_kind,
  coalesce(guardian_id, '00000000-0000-0000-0000-000000000000'::uuid),
  accepted_at desc
);

create or replace function public.student_accept_document(
  p_version_id uuid,
  p_decision text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_version public.document_versions%rowtype;
  v_document public.studio_documents%rowtype;
  v_minor boolean;
  v_allowed boolean := false;
  v_acceptance_id uuid;
  v_existing uuid;
  v_existing_decision text;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.* into v_student
  from public.students s
  where s.user_id=(select auth.uid())
    and s.active
    and s.lifecycle_status='active'
    and private.is_current_student(s.id,s.studio_id)
  limit 1
  for update;

  if not found then raise exception 'student_context_not_found'; end if;

  select * into v_version
  from public.document_versions
  where id=p_version_id;
  if not found or v_version.studio_id<>v_student.studio_id then
    raise exception 'document_version_not_found';
  end if;

  select * into v_document
  from public.studio_documents
  where id=v_version.document_id;

  if not private.document_version_applies_to_student(p_version_id,v_student.id,null) then
    raise exception 'document_not_applicable';
  end if;

  if v_version.response_mode='informational' then
    raise exception 'document_no_acceptance_required';
  end if;
  if p_decision not in ('accepted','declined') then
    raise exception 'document_decision_invalid';
  end if;
  if v_version.response_mode='accept_required' and p_decision<>'accepted' then
    raise exception 'document_acceptance_required';
  end if;

  v_minor := private.student_is_minor(v_student.id,current_date);

  v_allowed := case v_version.acceptance_party
    when 'student' then true
    when 'guardian_if_minor' then v_minor is false
    when 'student_and_guardian' then true
    when 'guardian_only' then false
    else false
  end;

  if not v_allowed then raise exception 'guardian_acceptance_required'; end if;

  select a.id,a.decision
    into v_existing,v_existing_decision
  from public.document_acceptances a
  where a.version_id=p_version_id
    and a.student_id=v_student.id
    and a.acceptor_kind='student'
    and a.guardian_id is null
    and not exists (
      select 1
      from public.document_acceptance_invalidations i
      where i.acceptance_id=a.id
    )
  order by a.accepted_at desc,a.created_at desc,a.id desc
  limit 1;

  if v_existing is not null
     and (
       v_version.response_mode<>'decision_optional'
       or v_existing_decision=p_decision
     ) then
    return jsonb_build_object(
      'ok',true,
      'acceptance_id',v_existing,
      'already_recorded',true,
      'decision',v_existing_decision,
      'satisfied',private.document_requirement_satisfied(p_version_id,v_student.id),
      'remaining_blockers',private.student_booking_blockers(v_student.id,null)
    );
  end if;

  insert into public.document_acceptances(
    studio_id,student_id,version_id,acceptor_kind,decision,method,
    affirmation_text,evidence,actor_user_id
  )
  values (
    v_student.studio_id,v_student.id,p_version_id,'student',p_decision,'student_portal',
    v_version.affirmation_text,
    jsonb_build_object(
      'document_name',v_document.name,
      'version_number',v_version.version_number,
      'file_path',v_version.file_path,
      'file_name',v_version.file_name,
      'content_sha256',v_version.content_sha256,
      'response_mode',v_version.response_mode,
      'acceptance_party',v_version.acceptance_party,
      'previous_acceptance_id',v_existing,
      'previous_decision',v_existing_decision
    ) || coalesce(p_evidence,'{}'::jsonb),
    (select auth.uid())
  )
  returning id into v_acceptance_id;

  return jsonb_build_object(
    'ok',true,
    'acceptance_id',v_acceptance_id,
    'already_recorded',false,
    'decision',p_decision,
    'previous_acceptance_id',v_existing,
    'previous_decision',v_existing_decision,
    'satisfied',private.document_requirement_satisfied(p_version_id,v_student.id),
    'remaining_blockers',private.student_booking_blockers(v_student.id,null)
  );
end;
$$;

create or replace function public.guardian_accept_document(
  p_token text,
  p_version_id uuid,
  p_decision text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_invite public.guardian_document_invitations%rowtype;
  v_guardian public.student_guardians%rowtype;
  v_version public.document_versions%rowtype;
  v_document public.studio_documents%rowtype;
  v_existing uuid;
  v_existing_decision text;
  v_acceptance_id uuid;
  v_pending integer;
begin
  if nullif(trim(coalesce(p_token,'')),'') is null then
    raise exception 'guardian_token_required';
  end if;

  v_hash := encode(digest(p_token,'sha256'),'hex');

  select * into v_invite
  from public.guardian_document_invitations
  where token_hash=v_hash
  for update;

  if not found then raise exception 'guardian_invitation_not_found'; end if;
  if v_invite.status='revoked' then raise exception 'guardian_invitation_revoked'; end if;
  if v_invite.expires_at<=now() then raise exception 'guardian_invitation_expired'; end if;

  select * into v_guardian
  from public.student_guardians
  where id=v_invite.guardian_id
    and active;
  if not found then raise exception 'guardian_not_active'; end if;

  select * into v_version
  from public.document_versions
  where id=p_version_id
    and studio_id=v_invite.studio_id;
  if not found then raise exception 'document_version_not_found'; end if;

  select * into v_document
  from public.studio_documents
  where id=v_version.document_id;

  if v_version.acceptance_party not in ('guardian_if_minor','student_and_guardian','guardian_only') then
    raise exception 'guardian_not_allowed_for_document';
  end if;
  if not private.document_version_applies_to_student(p_version_id,v_invite.student_id,null) then
    raise exception 'document_not_applicable';
  end if;
  if v_version.response_mode='informational' then
    raise exception 'document_no_acceptance_required';
  end if;
  if p_decision not in ('accepted','declined') then
    raise exception 'document_decision_invalid';
  end if;
  if v_version.response_mode='accept_required' and p_decision<>'accepted' then
    raise exception 'document_acceptance_required';
  end if;

  select a.id,a.decision
    into v_existing,v_existing_decision
  from public.document_acceptances a
  where a.version_id=p_version_id
    and a.student_id=v_invite.student_id
    and a.acceptor_kind='guardian'
    and a.guardian_id=v_guardian.id
    and not exists (
      select 1
      from public.document_acceptance_invalidations i
      where i.acceptance_id=a.id
    )
  order by a.accepted_at desc,a.created_at desc,a.id desc
  limit 1;

  if v_existing is not null
     and (
       v_version.response_mode<>'decision_optional'
       or v_existing_decision=p_decision
     ) then
    v_acceptance_id := v_existing;
  else
    insert into public.document_acceptances(
      studio_id,student_id,version_id,acceptor_kind,guardian_id,decision,method,
      affirmation_text,evidence,actor_user_id
    )
    values (
      v_invite.studio_id,v_invite.student_id,p_version_id,'guardian',v_guardian.id,p_decision,'guardian_link',
      v_version.affirmation_text,
      jsonb_build_object(
        'document_name',v_document.name,
        'version_number',v_version.version_number,
        'file_path',v_version.file_path,
        'file_name',v_version.file_name,
        'content_sha256',v_version.content_sha256,
        'relationship',v_guardian.relationship,
        'previous_acceptance_id',v_existing,
        'previous_decision',v_existing_decision
      ) || coalesce(p_evidence,'{}'::jsonb),
      null
    )
    returning id into v_acceptance_id;
  end if;

  select count(*)::integer into v_pending
  from public.document_versions dv
  where dv.studio_id=v_invite.studio_id
    and dv.status in ('active','scheduled')
    and dv.published_at is not null
    and coalesce(dv.effective_at,dv.published_at)<=now()
    and dv.retired_at is null
    and dv.acceptance_party in ('guardian_if_minor','student_and_guardian','guardian_only')
    and private.document_version_applies_to_student(dv.id,v_invite.student_id,null)
    and not private.document_party_satisfied(dv.id,v_invite.student_id,'guardian')
    and not exists (
      select 1
      from public.document_versions newer
      where newer.document_id=dv.document_id
        and newer.version_number>dv.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at,newer.published_at)<=now()
        and newer.retired_at is null
    );

  if v_pending=0 then
    update public.guardian_document_invitations
    set status='completed',completed_at=coalesce(completed_at,now())
    where id=v_invite.id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'acceptance_id',v_acceptance_id,
    'already_recorded',
      v_existing is not null
      and (
        v_version.response_mode<>'decision_optional'
        or v_existing_decision=p_decision
      ),
    'decision',p_decision,
    'previous_acceptance_id',
      case when v_acceptance_id<>v_existing then v_existing else null end,
    'previous_decision',
      case when v_acceptance_id<>v_existing then v_existing_decision else null end,
    'guardian_pending',v_pending,
    'requirement_satisfied',
      private.document_requirement_satisfied(p_version_id,v_invite.student_id)
  );
end;
$$;

create or replace function private.student_booking_blockers(
  p_student_id uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_result jsonb := '[]'::jsonb;
  v_documents jsonb;
  v_row public.student_booking_restrictions%rowtype;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then return v_result; end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
    into v_documents
  from jsonb_array_elements(
    coalesce(
      private.student_document_blockers(p_student_id,p_session_id),
      '[]'::jsonb
    )
  ) as blockers(item)
  where not exists (
    select 1
    from public.student_booking_exceptions e
    where e.studio_id=v_student.studio_id
      and e.student_id=p_student_id
      and e.revoked_at is null
      and e.starts_at<=now()
      and e.expires_at>now()
      and (
        (
          e.source_id is not null
          and (
            e.source_id = nullif(item->>'version_id','')::uuid
            or e.source_id = nullif(item->>'document_id','')::uuid
          )
        )
        or (
          e.source_id is null
          and e.restriction_code = item->>'code'
        )
        or (
          e.source_id is null
          and e.restriction_code is null
        )
      )
  );

  v_result := v_result || coalesce(v_documents,'[]'::jsonb);

  for v_row in
    select r.*
    from public.student_booking_restrictions r
    where r.studio_id = v_student.studio_id
      and r.student_id = p_student_id
      and r.resolved_at is null
      and r.starts_at <= now()
      and (r.expires_at is null or r.expires_at > now())
      and not exists (
        select 1
        from public.student_booking_exceptions e
        where e.studio_id = r.studio_id
          and e.student_id = r.student_id
          and e.revoked_at is null
          and e.starts_at <= now()
          and e.expires_at > now()
          and (
            e.source_id = r.id
            or (e.source_id is null and e.restriction_code = r.code)
            or (e.source_id is null and e.restriction_code is null)
          )
      )
    order by r.created_at
  loop
    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'code', v_row.code,
        'type', v_row.source_type,
        'title', v_row.title,
        'detail', v_row.detail,
        'action_kind', v_row.action_kind,
        'action_href', v_row.action_href,
        'action_label', case v_row.action_kind
          when 'payment' then 'Realizar pago'
          when 'documents' then 'Revisar documentos'
          when 'profile' then 'Completar perfil'
          when 'contact_studio' then 'Contactar al estudio'
          else 'Resolver requisito'
        end,
        'restriction_id', v_row.id
      )
    );
  end loop;

  if exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_student.studio_id
      and pa.student_id = p_student_id
      and pa.status = 'active'
      and pa.access_blocked
  ) and not exists (
    select 1
    from public.student_booking_exceptions e
    where e.studio_id = v_student.studio_id
      and e.student_id = p_student_id
      and e.revoked_at is null
      and e.starts_at <= now()
      and e.expires_at > now()
      and e.restriction_code = 'payment_pending'
  ) then
    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'code', 'payment_pending',
        'type', 'payment',
        'title', 'Tienes un pago pendiente',
        'detail', 'Hay un adeudo vencido o una condición de pago que debes resolver antes de realizar nuevas reservas.',
        'action_kind', 'payment',
        'action_href', '/student/paquete',
        'action_label', 'Revisar pago'
      )
    );
  end if;

  return v_result;
end;
$$;
