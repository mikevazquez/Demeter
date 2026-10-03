create or replace function private.student_document_blockers(
  p_student_id uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_version record;
  v_result jsonb := '[]'::jsonb;
  v_minor boolean;
  v_guardian_required boolean;
  v_has_guardian boolean;
  v_scope_ok boolean;
  v_timezone text;
  v_today date;
begin
  select * into v_student from public.students where id=p_student_id;
  if not found then return v_result; end if;

  if v_student.student_type='trial' then
    select coalesce(timezone,'America/Mexico_City') into v_timezone
    from public.studios where id=v_student.studio_id;
    v_today:=(clock_timestamp() at time zone v_timezone)::date;
    if not private.student_has_active_enrollment(v_student.studio_id,v_student.id,v_today) then
      return v_result;
    end if;
  end if;

  if p_session_id is not null then
    select * into v_session from public.class_sessions
    where id=p_session_id and studio_id=v_student.studio_id;
  end if;

  v_minor:=private.student_is_minor(p_student_id,current_date);

  for v_version in
    select dv.*,d.name as document_name
    from public.document_versions dv
    join public.studio_documents d on d.id=dv.document_id
    where dv.studio_id=v_student.studio_id
      and dv.status in ('active','scheduled')
      and dv.published_at is not null
      and coalesce(dv.effective_at,dv.published_at)<=now()
      and dv.retired_at is null
      and dv.response_mode<>'informational'
      and d.archived_at is null
    order by dv.document_id,dv.version_number desc
  loop
    if exists(
      select 1 from public.document_versions newer
      where newer.document_id=v_version.document_id
        and newer.version_number>v_version.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at,newer.published_at)<=now()
        and newer.retired_at is null
    ) then continue; end if;

    if not private.document_version_applies_to_student(v_version.id,p_student_id,p_session_id) then continue; end if;

    v_scope_ok:=v_version.enforcement_scope='global_booking'
      or (v_version.enforcement_scope='activity_booking' and p_session_id is not null);
    if not v_scope_ok then continue; end if;
    if private.document_requirement_satisfied(v_version.id,p_student_id) then continue; end if;

    v_guardian_required:=v_version.acceptance_party in ('guardian_if_minor','student_and_guardian','guardian_only')
      and (v_minor is true or v_minor is null);

    if v_guardian_required and v_minor is null then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'code','birth_date_required','type','profile','title','Completa tu fecha de nacimiento',
        'detail','Necesitamos tu fecha de nacimiento para determinar quién debe aceptar los documentos obligatorios.',
        'action_kind','profile','action_href','/student/perfil','action_label','Completar perfil',
        'version_id',v_version.id,'document_id',v_version.document_id,'document_name',v_version.document_name
      ));
      continue;
    end if;

    select exists(
      select 1 from public.student_guardians g
      where g.student_id=p_student_id and g.studio_id=v_student.studio_id and g.active
    ) into v_has_guardian;

    if v_guardian_required and not v_has_guardian then
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'code','guardian_required','type','document','title','Necesitamos a tu responsable',
        'detail',format('Tu responsable debe completar %s antes de que puedas reservar.',v_version.document_name),
        'action_kind','documents','action_href','/student/documentos/responsable','action_label','Agregar responsable',
        'version_id',v_version.id,'document_id',v_version.document_id,'document_name',v_version.document_name
      ));
    else
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'code','document_required','type','document','title',format('%s pendiente',v_version.document_name),
        'detail',case when v_version.enforcement_scope='activity_booking'
          then 'Necesitas completar este documento antes de reservar esta actividad.'
          else 'Necesitas completar este documento antes de realizar nuevas reservas.' end,
        'action_kind','documents','action_href','/student/documentos/'||v_version.id::text,'action_label','Revisar documento',
        'version_id',v_version.id,'document_id',v_version.document_id,'document_name',v_version.document_name
      ));
    end if;
  end loop;
  return v_result;
end;
$function$;

create or replace function public.student_document_center()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_student public.students%rowtype;
  v_minor boolean;
  v_items jsonb:='[]'::jsonb;
  v_row record;
  v_satisfied boolean;
  v_student_ok boolean;
  v_guardian_ok boolean;
  v_timezone text;
  v_today date;
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

  if v_student.student_type='trial' then
    select coalesce(timezone,'America/Mexico_City') into v_timezone
    from public.studios where id=v_student.studio_id;
    v_today:=(clock_timestamp() at time zone v_timezone)::date;

    if not private.student_has_active_enrollment(v_student.studio_id,v_student.id,v_today) then
      return jsonb_build_object(
        'student_id',v_student.id,'is_minor',null,
        'items','[]'::jsonb,'booking_blockers','[]'::jsonb,
        'locked_until_enrollment',true
      );
    end if;
  end if;

  v_minor:=private.student_is_minor(v_student.id,current_date);

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
    if exists(
      select 1 from public.document_versions newer
      where newer.document_id=v_row.document_id
        and newer.version_number>v_row.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at,newer.published_at)<=now()
        and newer.retired_at is null
    ) then continue; end if;

    if not private.document_version_applies_to_student(v_row.id,v_student.id,null) then continue; end if;

    v_satisfied:=private.document_requirement_satisfied(v_row.id,v_student.id);
    v_student_ok:=private.document_party_satisfied(v_row.id,v_student.id,'student');
    v_guardian_ok:=private.document_party_satisfied(v_row.id,v_student.id,'guardian');

    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'document_id',v_row.document_id,'version_id',v_row.id,'name',v_row.document_name,
      'document_type',v_row.document_type,'description',v_row.description,
      'version_number',v_row.version_number,'response_mode',v_row.response_mode,
      'acceptance_party',v_row.acceptance_party,'audience_scope',v_row.audience_scope,
      'enforcement_scope',v_row.enforcement_scope,'effective_at',v_row.effective_at,
      'file_path',v_row.file_path,'file_name',v_row.file_name,'mime_type',v_row.mime_type,
      'file_size_bytes',v_row.file_size_bytes,'affirmation_text',v_row.affirmation_text,
      'satisfied',v_satisfied,'student_completed',v_student_ok,'guardian_completed',v_guardian_ok,
      'minor',v_minor,'blocks_booking',v_row.enforcement_scope='global_booking' and not v_satisfied
    ));
  end loop;

  return jsonb_build_object(
    'student_id',v_student.id,'is_minor',v_minor,'items',v_items,
    'booking_blockers',private.student_booking_blockers(v_student.id,null),
    'locked_until_enrollment',false
  );
end;
$function$;
