-- Document exceptions never waive active restrictions or payment blocks.
CREATE OR REPLACE FUNCTION public.admin_grant_booking_exception(p_student_id uuid, p_restriction_code text, p_source_id uuid, p_reason text, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'students.write') then raise exception 'forbidden'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'exception_reason_required'; end if;
  if nullif(trim(coalesce(p_restriction_code,'')),'') is not null or p_source_id is not null then raise exception 'document_exception_only'; end if;
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '14 days' then raise exception 'exception_expiry_invalid'; end if;

  insert into public.student_booking_exceptions(
    studio_id,student_id,restriction_code,source_id,reason,expires_at,granted_by
  )
  values (
    v_student.studio_id,v_student.id,nullif(trim(coalesce(p_restriction_code,'')),''),
    p_source_id,trim(p_reason),p_expires_at,(select auth.uid())
  )
  returning id into v_id;

  insert into public.document_incidents(
    studio_id,student_id,incident_type,status,reason,details,created_by
  )
  values (
    v_student.studio_id,v_student.id,'temporary_exception','resolved',trim(p_reason),
    jsonb_build_object('exception_id',v_id,'expires_at',p_expires_at,'restriction_code',p_restriction_code),
    (select auth.uid())
  );

  return jsonb_build_object('ok',true,'exception_id',v_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_record_external_document_acceptance(p_student_id uuid, p_version_id uuid, p_acceptor_kind text, p_guardian_id uuid, p_decision text, p_method text, p_evidence jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student public.students%rowtype;
  v_version public.document_versions%rowtype;
  v_document public.studio_documents%rowtype;
  v_acceptance_id uuid;
  v_incident_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;
  if not (private.has_capability(v_student.studio_id,'documents.manage') or private.has_capability(v_student.studio_id,'students.write')) then raise exception 'forbidden'; end if;

  select * into v_version
  from public.document_versions
  where id=p_version_id
    and studio_id=v_student.studio_id;
  if not found then raise exception 'document_version_not_found'; end if;

  select * into v_document from public.studio_documents where id=v_version.document_id;

  if p_acceptor_kind not in ('student','guardian') then raise exception 'acceptor_kind_invalid'; end if;
  if p_acceptor_kind='student' and p_guardian_id is not null then raise exception 'guardian_not_allowed'; end if;
  if p_acceptor_kind='guardian' then
    if p_guardian_id is null or not exists (
      select 1 from public.student_guardians g
      where g.id=p_guardian_id and g.student_id=p_student_id and g.studio_id=v_student.studio_id
    ) then
      raise exception 'guardian_invalid';
    end if;
  end if;
  if p_decision not in ('accepted','declined') then raise exception 'document_decision_invalid'; end if;
  if v_version.response_mode='accept_required' and p_decision<>'accepted' then
    raise exception 'document_acceptance_required';
  end if;
  if p_method not in ('in_person','external') then raise exception 'external_method_invalid'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'external_reason_required'; end if;

  insert into public.document_acceptances(
    studio_id,student_id,version_id,acceptor_kind,guardian_id,decision,method,
    affirmation_text,evidence,actor_user_id
  )
  values (
    v_student.studio_id,v_student.id,v_version.id,p_acceptor_kind,p_guardian_id,p_decision,p_method,
    v_version.affirmation_text,
    jsonb_build_object(
      'document_name',v_document.name,
      'version_number',v_version.version_number,
      'file_path',v_version.file_path,
      'file_name',v_version.file_name,
      'content_sha256',v_version.content_sha256,
      'registered_by_admin',true,
      'registration_reason',trim(p_reason)
    ) || coalesce(p_evidence,'{}'::jsonb),
    (select auth.uid())
  )
  returning id into v_acceptance_id;

  insert into public.document_incidents(
    studio_id,student_id,version_id,acceptance_id,guardian_id,incident_type,status,
    reason,details,created_by,resolved_by,resolved_at,resolution_note
  )
  values (
    v_student.studio_id,v_student.id,v_version.id,v_acceptance_id,p_guardian_id,
    case when p_method='in_person' then 'in_person_acceptance' else 'external_evidence' end,
    'resolved',trim(p_reason),coalesce(p_evidence,'{}'::jsonb),(select auth.uid()),
    (select auth.uid()),now(),'Evidencia registrada mediante flujo administrativo controlado.'
  )
  returning id into v_incident_id;

  return jsonb_build_object(
    'ok',true,'acceptance_id',v_acceptance_id,'incident_id',v_incident_id,
    'satisfied',private.document_requirement_satisfied(v_version.id,v_student.id)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_student_document_profile(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not (private.has_capability(v_student.studio_id,'documents.read') or private.has_capability(v_student.studio_id,'students.write')) then raise exception 'forbidden'; end if;

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
$function$
;

CREATE OR REPLACE FUNCTION private.student_booking_blockers(p_student_id uuid, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
