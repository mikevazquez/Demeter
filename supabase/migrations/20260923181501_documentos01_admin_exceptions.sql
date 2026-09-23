
-- DOCUMENTOS-01 · administrative exception workflows

create or replace function public.admin_record_external_document_acceptance(
  p_student_id uuid,
  p_version_id uuid,
  p_acceptor_kind text,
  p_guardian_id uuid,
  p_decision text,
  p_method text,
  p_evidence jsonb,
  p_reason text
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
  v_acceptance_id uuid;
  v_incident_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'documents.manage') then raise exception 'forbidden'; end if;

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
$$;

revoke all on function public.admin_record_external_document_acceptance(
  uuid,uuid,text,uuid,text,text,jsonb,text
) from public, anon, authenticated;
grant execute on function public.admin_record_external_document_acceptance(
  uuid,uuid,text,uuid,text,text,jsonb,text
) to authenticated;

create or replace function public.admin_resolve_booking_restriction(
  p_restriction_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restriction public.student_booking_restrictions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_restriction
  from public.student_booking_restrictions
  where id=p_restriction_id
  for update;
  if not found then raise exception 'restriction_not_found'; end if;
  if not private.has_capability(v_restriction.studio_id,'students.write') then raise exception 'forbidden'; end if;

  update public.student_booking_restrictions
  set resolved_at=coalesce(resolved_at,now()),
      resolved_by=coalesce(resolved_by,(select auth.uid())),
      resolution_note=coalesce(nullif(trim(coalesce(p_note,'')),''),resolution_note)
  where id=p_restriction_id;

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.admin_resolve_booking_restriction(uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_resolve_booking_restriction(uuid,text)
to authenticated;

create or replace function public.admin_revoke_booking_exception(
  p_exception_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exception public.student_booking_exceptions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_exception
  from public.student_booking_exceptions
  where id=p_exception_id
  for update;
  if not found then raise exception 'exception_not_found'; end if;
  if not private.has_capability(v_exception.studio_id,'students.write') then raise exception 'forbidden'; end if;

  update public.student_booking_exceptions
  set revoked_at=coalesce(revoked_at,now()),
      revoked_by=coalesce(revoked_by,(select auth.uid()))
  where id=p_exception_id;

  insert into public.document_audit_events(
    studio_id,student_id,event_type,actor_user_id,details
  )
  values (
    v_exception.studio_id,v_exception.student_id,'booking_exception_revoked',(select auth.uid()),
    jsonb_build_object('exception_id',v_exception.id,'reason',nullif(trim(coalesce(p_reason,'')),''))
  );

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.admin_revoke_booking_exception(uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_revoke_booking_exception(uuid,text)
to authenticated;
