CREATE OR REPLACE FUNCTION public.admin_publish_document_version(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version public.document_versions%rowtype;
  v_document public.studio_documents%rowtype;
  v_status text;
  v_student record;
  v_notification_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_version
  from public.document_versions
  where id = p_version_id
  for update;

  if not found then raise exception 'document_version_not_found'; end if;
  if not private.has_capability(v_version.studio_id,'documents.manage') then raise exception 'forbidden'; end if;
  if v_version.status <> 'draft' then raise exception 'document_version_not_draft'; end if;

  select * into v_document from public.studio_documents where id=v_version.document_id;

  if v_version.response_mode <> 'informational' and nullif(trim(coalesce(v_version.file_path,'')),'') is null then
    raise exception 'document_file_required';
  end if;

  if v_version.audience_scope in ('activity','event','student')
     and not exists (select 1 from public.document_version_targets where version_id=p_version_id) then
    raise exception 'document_target_required';
  end if;

  v_status := case
    when coalesce(v_version.effective_at,now()) > now() then 'scheduled'
    else 'active'
  end;

  update public.document_versions
  set status = v_status,
      published_at = now(),
      published_by = (select auth.uid()),
      effective_at = coalesce(effective_at,now()),
      updated_at = now()
  where id = p_version_id;

  if v_status = 'active' then
    update public.document_versions prior
    set status='superseded',
        superseded_at=now(),
        updated_at=now()
    where prior.document_id=v_version.document_id
      and prior.id<>p_version_id
      and prior.status='active'
      and prior.version_number<v_version.version_number;
  end if;

  insert into public.document_audit_events(
    studio_id,document_id,version_id,event_type,actor_user_id,details
  )
  values (
    v_version.studio_id,v_version.document_id,p_version_id,'version_published',(select auth.uid()),
    jsonb_build_object('status',v_status,'effective_at',coalesce(v_version.effective_at,now()))
  );

  if v_version.enforcement_scope = 'global_booking' then
    for v_student in
      select s.id,s.user_id
      from public.students s
      where s.studio_id=v_version.studio_id
        and s.active
        and s.lifecycle_status='active'
    loop
      if private.document_version_applies_to_student(p_version_id,v_student.id,null)
         and not private.document_requirement_satisfied(p_version_id,v_student.id) then
        insert into public.app_notifications(
          studio_id,recipient_user_id,recipient_kind,student_id,notification_type,
          title,body,payload,deduplication_key
        )
        values (
          v_version.studio_id,
          v_student.user_id,
          'student',
          v_student.id,
          'document_required',
          'Nuevo documento pendiente',
          format('Necesitas revisar %s antes de realizar nuevas reservas.',v_document.name),
          jsonb_build_object(
            'document_id',v_version.document_id,
            'version_id',p_version_id,
            'href','/student/documentos/'||p_version_id::text
          ),
          'document-required:'||p_version_id::text||':'||v_student.id::text
        )
        on conflict (studio_id, deduplication_key) do nothing;
        v_notification_count := v_notification_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok',true,
    'status',v_status,
    'version_id',p_version_id,
    'notifications',v_notification_count
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.activate_due_document_versions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version record;
  v_student record;
  v_count integer := 0;
begin
  for v_version in
    select dv.*, d.name as document_name
    from public.document_versions dv
    join public.studio_documents d on d.id=dv.document_id
    where dv.status='scheduled'
      and dv.published_at is not null
      and coalesce(dv.effective_at,dv.published_at) <= now()
      and dv.retired_at is null
    order by dv.effective_at, dv.created_at
    for update of dv skip locked
  loop
    update public.document_versions
    set status='active',updated_at=now()
    where id=v_version.id;

    update public.document_versions prior
    set status='superseded',
        superseded_at=coalesce(superseded_at,now()),
        updated_at=now()
    where prior.document_id=v_version.document_id
      and prior.id<>v_version.id
      and prior.version_number<v_version.version_number
      and prior.status='active';

    insert into public.document_audit_events(
      studio_id,document_id,version_id,event_type,actor_user_id,details
    )
    values (
      v_version.studio_id,v_version.document_id,v_version.id,
      'scheduled_version_activated',null,
      jsonb_build_object('effective_at',v_version.effective_at)
    );

    if v_version.enforcement_scope='global_booking' then
      for v_student in
        select s.id,s.user_id
        from public.students s
        where s.studio_id=v_version.studio_id
          and s.active
          and s.lifecycle_status='active'
      loop
        if private.document_version_applies_to_student(v_version.id,v_student.id,null)
           and not private.document_requirement_satisfied(v_version.id,v_student.id) then
          insert into public.app_notifications(
            studio_id,recipient_user_id,recipient_kind,student_id,notification_type,
            title,body,payload,deduplication_key
          )
          values (
            v_version.studio_id,
            v_student.user_id,
            'student',
            v_student.id,
            'document_required',
            'Nuevo documento pendiente',
            format('Necesitas revisar %s antes de realizar nuevas reservas.',v_version.document_name),
            jsonb_build_object(
              'document_id',v_version.document_id,
              'version_id',v_version.id,
              'href','/student/documentos/'||v_version.id::text
            ),
            'document-required:'||v_version.id::text||':'||v_student.id::text
          )
          on conflict (studio_id, deduplication_key) do nothing;
        end if;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;
