
-- DOCUMENTOS-01 · secure RPCs and booking eligibility integration

create or replace function public.admin_create_document_draft(
  p_studio_id uuid,
  p_name text,
  p_document_type text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_version_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if not private.has_capability(p_studio_id,'documents.manage') then raise exception 'forbidden'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'document_name_required'; end if;
  if p_document_type not in ('contract','regulation','waiver','privacy','consent','notice','other') then
    raise exception 'document_type_invalid';
  end if;

  insert into public.studio_documents(studio_id,name,document_type,description,created_by)
  values (p_studio_id,trim(p_name),p_document_type,nullif(trim(coalesce(p_description,'')),''),(select auth.uid()))
  returning id into v_document_id;

  insert into public.document_versions(
    studio_id,document_id,version_number,status,created_by,
    affirmation_text,effective_at
  )
  values (
    p_studio_id,v_document_id,1,'draft',(select auth.uid()),
    'He leído y acepto el contenido de este documento.',
    now()
  )
  returning id into v_version_id;

  insert into public.document_audit_events(
    studio_id,document_id,version_id,event_type,actor_user_id,details
  )
  values (
    p_studio_id,v_document_id,v_version_id,'draft_created',(select auth.uid()),
    jsonb_build_object('version_number',1)
  );

  return jsonb_build_object(
    'document_id',v_document_id,
    'version_id',v_version_id,
    'version_number',1
  );
end;
$$;

revoke all on function public.admin_create_document_draft(uuid,text,text,text)
from public, anon, authenticated;
grant execute on function public.admin_create_document_draft(uuid,text,text,text)
to authenticated;

create or replace function public.admin_update_document_draft(
  p_version_id uuid,
  p_name text,
  p_document_type text,
  p_description text,
  p_response_mode text,
  p_acceptance_party text,
  p_audience_scope text,
  p_enforcement_scope text,
  p_requires_reacceptance boolean,
  p_effective_at timestamptz,
  p_affirmation_text text,
  p_change_summary text,
  p_file_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_content_sha256 text,
  p_targets jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
  v_target jsonb;
  v_target_type text;
  v_target_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_version
  from public.document_versions
  where id = p_version_id
  for update;

  if not found then raise exception 'document_version_not_found'; end if;
  if not private.has_capability(v_version.studio_id,'documents.manage') then raise exception 'forbidden'; end if;
  if v_version.status <> 'draft' then raise exception 'document_version_not_draft'; end if;

  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'document_name_required'; end if;
  if p_document_type not in ('contract','regulation','waiver','privacy','consent','notice','other') then
    raise exception 'document_type_invalid';
  end if;
  if p_response_mode not in ('accept_required','decision_optional','informational') then
    raise exception 'document_response_mode_invalid';
  end if;
  if p_acceptance_party not in ('student','guardian_if_minor','student_and_guardian','guardian_only') then
    raise exception 'document_acceptance_party_invalid';
  end if;
  if p_audience_scope not in ('all','adults','minors','activity','event','student') then
    raise exception 'document_audience_invalid';
  end if;
  if p_enforcement_scope not in ('global_booking','activity_booking','event_registration','none') then
    raise exception 'document_enforcement_invalid';
  end if;
  if p_response_mode = 'informational' and p_enforcement_scope <> 'none' then
    raise exception 'informational_document_cannot_block';
  end if;
  if jsonb_typeof(coalesce(p_targets,'[]'::jsonb)) <> 'array' then
    raise exception 'document_targets_invalid';
  end if;

  update public.studio_documents
  set name = trim(p_name),
      document_type = p_document_type,
      description = nullif(trim(coalesce(p_description,'')),''),
      updated_at = now()
  where id = v_version.document_id;

  update public.document_versions
  set response_mode = p_response_mode,
      acceptance_party = p_acceptance_party,
      audience_scope = p_audience_scope,
      enforcement_scope = p_enforcement_scope,
      requires_reacceptance = coalesce(p_requires_reacceptance,true),
      effective_at = coalesce(p_effective_at,now()),
      affirmation_text = nullif(trim(coalesce(p_affirmation_text,'')),''),
      change_summary = nullif(trim(coalesce(p_change_summary,'')),''),
      file_path = nullif(trim(coalesce(p_file_path,'')),''),
      file_name = nullif(trim(coalesce(p_file_name,'')),''),
      mime_type = nullif(trim(coalesce(p_mime_type,'')),''),
      file_size_bytes = p_file_size_bytes,
      content_sha256 = nullif(trim(coalesce(p_content_sha256,'')),''),
      updated_at = now()
  where id = p_version_id;

  delete from public.document_version_targets where version_id = p_version_id;

  for v_target in select value from jsonb_array_elements(coalesce(p_targets,'[]'::jsonb))
  loop
    v_target_type := v_target->>'type';
    if v_target_type not in ('activity','event','student') then
      raise exception 'document_target_type_invalid';
    end if;
    begin
      v_target_id := (v_target->>'id')::uuid;
    exception when others then
      raise exception 'document_target_id_invalid';
    end;

    insert into public.document_version_targets(studio_id,version_id,target_type,target_id)
    values (v_version.studio_id,p_version_id,v_target_type,v_target_id)
    on conflict do nothing;
  end loop;

  if p_audience_scope in ('activity','event','student')
     and not exists (select 1 from public.document_version_targets where version_id=p_version_id) then
    raise exception 'document_target_required';
  end if;

  return jsonb_build_object('ok',true,'version_id',p_version_id);
end;
$$;

revoke all on function public.admin_update_document_draft(
  uuid,text,text,text,text,text,text,text,boolean,timestamptz,text,text,text,text,text,bigint,text,jsonb
) from public, anon, authenticated;
grant execute on function public.admin_update_document_draft(
  uuid,text,text,text,text,text,text,text,boolean,timestamptz,text,text,text,text,text,bigint,text,jsonb
) to authenticated;

create or replace function public.admin_publish_document_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
        on conflict (deduplication_key) do nothing;
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
$$;

revoke all on function public.admin_publish_document_version(uuid)
from public, anon, authenticated;
grant execute on function public.admin_publish_document_version(uuid)
to authenticated;

create or replace function public.admin_create_document_version(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.studio_documents%rowtype;
  v_source public.document_versions%rowtype;
  v_next integer;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_document from public.studio_documents where id=p_document_id;
  if not found then raise exception 'document_not_found'; end if;
  if not private.has_capability(v_document.studio_id,'documents.manage') then raise exception 'forbidden'; end if;

  if exists (
    select 1 from public.document_versions
    where document_id=p_document_id and status='draft'
  ) then
    raise exception 'document_draft_exists';
  end if;

  select * into v_source
  from public.document_versions
  where document_id=p_document_id
  order by version_number desc
  limit 1;

  v_next := coalesce(v_source.version_number,0)+1;

  insert into public.document_versions(
    studio_id,document_id,version_number,status,response_mode,acceptance_party,
    audience_scope,enforcement_scope,requires_reacceptance,effective_at,
    affirmation_text,change_summary,file_path,file_name,mime_type,file_size_bytes,
    content_sha256,created_by
  )
  values (
    v_document.studio_id,p_document_id,v_next,'draft',
    coalesce(v_source.response_mode,'accept_required'),
    coalesce(v_source.acceptance_party,'student'),
    coalesce(v_source.audience_scope,'all'),
    coalesce(v_source.enforcement_scope,'global_booking'),
    true,
    now(),
    coalesce(v_source.affirmation_text,'He leído y acepto el contenido de este documento.'),
    null,null,null,null,null,null,(select auth.uid())
  )
  returning id into v_id;

  if v_source.id is not null then
    insert into public.document_version_targets(studio_id,version_id,target_type,target_id)
    select studio_id,v_id,target_type,target_id
    from public.document_version_targets
    where version_id=v_source.id;
  end if;

  insert into public.document_audit_events(
    studio_id,document_id,version_id,event_type,actor_user_id,details
  )
  values (
    v_document.studio_id,p_document_id,v_id,'version_draft_created',(select auth.uid()),
    jsonb_build_object('version_number',v_next,'source_version_id',v_source.id)
  );

  return jsonb_build_object('ok',true,'version_id',v_id,'version_number',v_next);
end;
$$;

revoke all on function public.admin_create_document_version(uuid)
from public, anon, authenticated;
grant execute on function public.admin_create_document_version(uuid)
to authenticated;

create or replace function public.admin_retire_document_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_version from public.document_versions where id=p_version_id for update;
  if not found then raise exception 'document_version_not_found'; end if;
  if not private.has_capability(v_version.studio_id,'documents.manage') then raise exception 'forbidden'; end if;
  if v_version.status='draft' then raise exception 'document_version_not_published'; end if;

  update public.document_versions
  set status='retired',retired_at=now(),retired_by=(select auth.uid()),updated_at=now()
  where id=p_version_id;

  insert into public.document_audit_events(
    studio_id,document_id,version_id,event_type,actor_user_id,details
  )
  values (
    v_version.studio_id,v_version.document_id,p_version_id,'version_retired',(select auth.uid()),
    jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),''))
  );

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.admin_retire_document_version(uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_retire_document_version(uuid,text)
to authenticated;

create or replace function public.student_document_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_minor boolean;
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_satisfied boolean;
  v_student_ok boolean;
  v_guardian_ok boolean;
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

  v_minor := private.student_is_minor(v_student.id,current_date);

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
      select 1 from public.document_versions newer
      where newer.document_id=v_row.document_id
        and newer.version_number>v_row.version_number
        and newer.status in ('active','scheduled')
        and newer.published_at is not null
        and coalesce(newer.effective_at,newer.published_at)<=now()
        and newer.retired_at is null
    ) then continue; end if;

    if not private.document_version_applies_to_student(v_row.id,v_student.id,null) then
      continue;
    end if;

    v_satisfied := private.document_requirement_satisfied(v_row.id,v_student.id);
    v_student_ok := private.document_party_satisfied(v_row.id,v_student.id,'student');
    v_guardian_ok := private.document_party_satisfied(v_row.id,v_student.id,'guardian');

    v_items := v_items || jsonb_build_array(
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
        'effective_at',v_row.effective_at,
        'file_path',v_row.file_path,
        'file_name',v_row.file_name,
        'mime_type',v_row.mime_type,
        'file_size_bytes',v_row.file_size_bytes,
        'affirmation_text',v_row.affirmation_text,
        'satisfied',v_satisfied,
        'student_completed',v_student_ok,
        'guardian_completed',v_guardian_ok,
        'minor',v_minor,
        'blocks_booking',v_row.enforcement_scope='global_booking' and not v_satisfied
      )
    );
  end loop;

  return jsonb_build_object(
    'student_id',v_student.id,
    'is_minor',v_minor,
    'items',v_items,
    'booking_blockers',private.student_booking_blockers(v_student.id,null)
  );
end;
$$;

revoke all on function public.student_document_center()
from public, anon, authenticated;
grant execute on function public.student_document_center()
to authenticated;

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

  select
    dv.*,d.name as document_name,d.document_type,d.description,
    private.document_requirement_satisfied(dv.id,v_student.id) as satisfied,
    private.document_party_satisfied(dv.id,v_student.id,'student') as student_completed,
    private.document_party_satisfied(dv.id,v_student.id,'guardian') as guardian_completed,
    private.student_is_minor(v_student.id,current_date) as minor
  into v_row
  from public.document_versions dv
  join public.studio_documents d on d.id=dv.document_id
  where dv.id=p_version_id
    and dv.studio_id=v_student.studio_id
    and dv.published_at is not null
    and private.document_version_applies_to_student(dv.id,v_student.id,null);

  if not found then raise exception 'document_version_not_found'; end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.student_document_detail(uuid)
from public, anon, authenticated;
grant execute on function public.student_document_detail(uuid)
to authenticated;

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

  select * into v_version from public.document_versions where id=p_version_id;
  if not found or v_version.studio_id<>v_student.studio_id then
    raise exception 'document_version_not_found';
  end if;

  select * into v_document from public.studio_documents where id=v_version.document_id;

  if not private.document_version_applies_to_student(p_version_id,v_student.id,null) then
    raise exception 'document_not_applicable';
  end if;

  if v_version.response_mode='informational' then raise exception 'document_no_acceptance_required'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'document_decision_invalid'; end if;
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

  select a.id into v_existing
  from public.document_acceptances a
  where a.version_id=p_version_id
    and a.student_id=v_student.id
    and a.acceptor_kind='student'
    and a.guardian_id is null
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'ok',true,'acceptance_id',v_existing,'already_recorded',true,
      'satisfied',private.document_requirement_satisfied(p_version_id,v_student.id)
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
      'acceptance_party',v_version.acceptance_party
    ) || coalesce(p_evidence,'{}'::jsonb),
    (select auth.uid())
  )
  returning id into v_acceptance_id;

  return jsonb_build_object(
    'ok',true,
    'acceptance_id',v_acceptance_id,
    'already_recorded',false,
    'satisfied',private.document_requirement_satisfied(p_version_id,v_student.id),
    'remaining_blockers',private.student_booking_blockers(v_student.id,null)
  );
end;
$$;

revoke all on function public.student_accept_document(uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function public.student_accept_document(uuid,text,jsonb)
to authenticated;

create or replace function public.student_register_guardian(
  p_full_name text,
  p_email text,
  p_phone text,
  p_relationship text,
  p_relationship_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_guardian_id uuid;
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
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
  if private.student_is_minor(v_student.id,current_date) is distinct from true then
    raise exception 'guardian_not_required';
  end if;
  if nullif(trim(coalesce(p_full_name,'')),'') is null then raise exception 'guardian_name_required'; end if;
  if nullif(trim(coalesce(p_email,'')),'') is null and nullif(trim(coalesce(p_phone,'')),'') is null then
    raise exception 'guardian_contact_required';
  end if;
  if p_relationship not in ('mother','father','legal_guardian','family','other') then
    raise exception 'guardian_relationship_invalid';
  end if;

  update public.student_guardians
  set active=false,updated_at=now()
  where studio_id=v_student.studio_id
    and student_id=v_student.id
    and active;

  insert into public.student_guardians(
    studio_id,student_id,full_name,email,phone,relationship,relationship_detail,active,created_by
  )
  values (
    v_student.studio_id,v_student.id,trim(p_full_name),
    nullif(lower(trim(coalesce(p_email,''))),''),
    nullif(trim(coalesce(p_phone,'')),''),
    p_relationship,nullif(trim(coalesce(p_relationship_detail,'')),''),
    true,(select auth.uid())
  )
  returning id into v_guardian_id;

  update public.guardian_document_invitations
  set status='revoked',revoked_at=now()
  where studio_id=v_student.studio_id
    and student_id=v_student.id
    and status='pending';

  v_token := encode(gen_random_bytes(32),'hex');
  v_token_hash := encode(digest(v_token,'sha256'),'hex');

  insert into public.guardian_document_invitations(
    studio_id,student_id,guardian_id,token_hash,status,delivery_channel,
    destination_hint,expires_at,created_by
  )
  values (
    v_student.studio_id,v_student.id,v_guardian_id,v_token_hash,'pending',
    case when nullif(trim(coalesce(p_email,'')),'') is not null then 'email' else 'phone' end,
    case
      when nullif(trim(coalesce(p_email,'')),'') is not null then
        regexp_replace(lower(trim(p_email)),'^(.{1,2}).*(@.*)$','\1***\2')
      else '***'||right(regexp_replace(coalesce(p_phone,''),'\D','','g'),4)
    end,
    now()+interval '7 days',(select auth.uid())
  )
  returning id into v_invitation_id;

  insert into public.document_audit_events(
    studio_id,student_id,event_type,actor_user_id,details
  )
  values (
    v_student.studio_id,v_student.id,'guardian_invited',(select auth.uid()),
    jsonb_build_object('guardian_id',v_guardian_id,'invitation_id',v_invitation_id)
  );

  return jsonb_build_object(
    'ok',true,
    'guardian_id',v_guardian_id,
    'invitation_id',v_invitation_id,
    'token',v_token,
    'expires_at',now()+interval '7 days'
  );
end;
$$;

revoke all on function public.student_register_guardian(text,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.student_register_guardian(text,text,text,text,text)
to authenticated;

create or replace function public.guardian_document_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_invite public.guardian_document_invitations%rowtype;
  v_guardian public.student_guardians%rowtype;
  v_student public.students%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_row record;
begin
  if nullif(trim(coalesce(p_token,'')),'') is null then raise exception 'guardian_token_required'; end if;
  v_hash := encode(digest(p_token,'sha256'),'hex');

  select * into v_invite
  from public.guardian_document_invitations
  where token_hash=v_hash;

  if not found then raise exception 'guardian_invitation_not_found'; end if;
  if v_invite.status='revoked' then raise exception 'guardian_invitation_revoked'; end if;
  if v_invite.expires_at<=now() then raise exception 'guardian_invitation_expired'; end if;

  select * into v_guardian from public.student_guardians where id=v_invite.guardian_id and active;
  select * into v_student from public.students where id=v_invite.student_id;

  if v_guardian.id is null or v_student.id is null then raise exception 'guardian_invitation_invalid'; end if;

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
    ) then continue; end if;

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
    'guardian',jsonb_build_object(
      'id',v_guardian.id,'full_name',v_guardian.full_name,'relationship',v_guardian.relationship,
      'relationship_detail',v_guardian.relationship_detail
    ),
    'student',jsonb_build_object(
      'id',v_student.id,'full_name',v_student.full_name
    ),
    'items',v_items
  );
end;
$$;

revoke all on function public.guardian_document_invitation(text)
from public, anon, authenticated;
grant execute on function public.guardian_document_invitation(text)
to anon, authenticated;

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
  v_acceptance_id uuid;
  v_pending integer;
begin
  if nullif(trim(coalesce(p_token,'')),'') is null then raise exception 'guardian_token_required'; end if;
  v_hash := encode(digest(p_token,'sha256'),'hex');

  select * into v_invite
  from public.guardian_document_invitations
  where token_hash=v_hash
  for update;

  if not found then raise exception 'guardian_invitation_not_found'; end if;
  if v_invite.status='revoked' then raise exception 'guardian_invitation_revoked'; end if;
  if v_invite.expires_at<=now() then raise exception 'guardian_invitation_expired'; end if;

  select * into v_guardian from public.student_guardians where id=v_invite.guardian_id and active;
  if not found then raise exception 'guardian_not_active'; end if;

  select * into v_version
  from public.document_versions
  where id=p_version_id
    and studio_id=v_invite.studio_id;

  if not found then raise exception 'document_version_not_found'; end if;
  select * into v_document from public.studio_documents where id=v_version.document_id;

  if v_version.acceptance_party not in ('guardian_if_minor','student_and_guardian','guardian_only') then
    raise exception 'guardian_not_allowed_for_document';
  end if;
  if not private.document_version_applies_to_student(p_version_id,v_invite.student_id,null) then
    raise exception 'document_not_applicable';
  end if;
  if v_version.response_mode='informational' then raise exception 'document_no_acceptance_required'; end if;
  if p_decision not in ('accepted','declined') then raise exception 'document_decision_invalid'; end if;
  if v_version.response_mode='accept_required' and p_decision<>'accepted' then
    raise exception 'document_acceptance_required';
  end if;

  select a.id into v_existing
  from public.document_acceptances a
  where a.version_id=p_version_id
    and a.student_id=v_invite.student_id
    and a.acceptor_kind='guardian'
    and a.guardian_id=v_guardian.id
  limit 1;

  if v_existing is null then
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
        'relationship',v_guardian.relationship
      ) || coalesce(p_evidence,'{}'::jsonb),
      null
    )
    returning id into v_acceptance_id;
  else
    v_acceptance_id := v_existing;
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
      select 1 from public.document_versions newer
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
    'already_recorded',v_existing is not null,
    'guardian_pending',v_pending,
    'requirement_satisfied',private.document_requirement_satisfied(p_version_id,v_invite.student_id)
  );
end;
$$;

revoke all on function public.guardian_accept_document(text,uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function public.guardian_accept_document(text,uuid,text,jsonb)
to anon, authenticated;

create or replace function public.student_booking_restrictions_snapshot(p_session_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_studio_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select s.id,s.studio_id into v_student_id,v_studio_id
  from public.students s
  where s.user_id=(select auth.uid())
    and s.active
    and s.lifecycle_status='active'
  limit 1;

  if v_student_id is null or not private.is_current_student(v_student_id,v_studio_id) then
    raise exception 'student_context_not_found';
  end if;

  return private.student_booking_blockers(v_student_id,p_session_id);
end;
$$;

revoke all on function public.student_booking_restrictions_snapshot(uuid)
from public, anon, authenticated;
grant execute on function public.student_booking_restrictions_snapshot(uuid)
to authenticated;

create or replace function public.admin_add_booking_restriction(
  p_student_id uuid,
  p_code text,
  p_title text,
  p_detail text,
  p_action_kind text,
  p_action_href text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'students.write') then raise exception 'forbidden'; end if;
  if p_action_kind not in ('documents','payment','profile','contact_studio','custom') then
    raise exception 'restriction_action_invalid';
  end if;

  insert into public.student_booking_restrictions(
    studio_id,student_id,code,title,detail,action_kind,action_href,source_type,expires_at,created_by
  )
  values (
    v_student.studio_id,v_student.id,trim(p_code),trim(p_title),nullif(trim(coalesce(p_detail,'')),''),
    p_action_kind,nullif(trim(coalesce(p_action_href,'')),''),'admin',p_expires_at,(select auth.uid())
  )
  returning id into v_id;

  return jsonb_build_object('ok',true,'restriction_id',v_id);
end;
$$;

revoke all on function public.admin_add_booking_restriction(uuid,text,text,text,text,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.admin_add_booking_restriction(uuid,text,text,text,text,text,timestamptz)
to authenticated;

create or replace function public.admin_grant_booking_exception(
  p_student_id uuid,
  p_restriction_code text,
  p_source_id uuid,
  p_reason text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_student from public.students where id=p_student_id;
  if not found then raise exception 'student_not_found'; end if;
  if not private.has_capability(v_student.studio_id,'students.write') then raise exception 'forbidden'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'exception_reason_required'; end if;
  if p_expires_at is null or p_expires_at<=now() then raise exception 'exception_expiry_invalid'; end if;

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
$$;

revoke all on function public.admin_grant_booking_exception(uuid,text,uuid,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.admin_grant_booking_exception(uuid,text,uuid,text,timestamptz)
to authenticated;

create or replace function public.admin_invalidate_document_acceptance(
  p_acceptance_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acceptance public.document_acceptances%rowtype;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  select * into v_acceptance from public.document_acceptances where id=p_acceptance_id;
  if not found then raise exception 'acceptance_not_found'; end if;
  if not private.has_capability(v_acceptance.studio_id,'documents.manage') then raise exception 'forbidden'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'invalidation_reason_required'; end if;

  insert into public.document_acceptance_invalidations(
    studio_id,acceptance_id,reason,invalidated_by
  )
  values (
    v_acceptance.studio_id,v_acceptance.id,trim(p_reason),(select auth.uid())
  )
  returning id into v_id;

  insert into public.document_incidents(
    studio_id,student_id,version_id,acceptance_id,incident_type,status,reason,created_by,
    resolved_by,resolved_at,resolution_note
  )
  values (
    v_acceptance.studio_id,v_acceptance.student_id,v_acceptance.version_id,v_acceptance.id,
    'acceptance_invalidation','resolved',trim(p_reason),(select auth.uid()),
    (select auth.uid()),now(),'La evidencia original se conserva y el requisito vuelve a estar pendiente.'
  );

  insert into public.document_audit_events(
    studio_id,version_id,student_id,acceptance_id,event_type,actor_user_id,details
  )
  values (
    v_acceptance.studio_id,v_acceptance.version_id,v_acceptance.student_id,v_acceptance.id,
    'acceptance_invalidated',(select auth.uid()),jsonb_build_object('reason',trim(p_reason))
  );

  return jsonb_build_object('ok',true,'invalidation_id',v_id);
end;
$$;

revoke all on function public.admin_invalidate_document_acceptance(uuid,text)
from public, anon, authenticated;
grant execute on function public.admin_invalidate_document_acceptance(uuid,text)
to authenticated;


CREATE OR REPLACE FUNCTION private.booking_eligibility_core(target_session_id uuid, target_student_id uuid, p_allow_started_session boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.class_sessions%rowtype;
  v_student public.students%rowtype;
  v_policy public.enrollment_policies%rowtype;
  v_discipline_id uuid;
  v_credit_cost integer := 1;
  v_class_date date;
  v_timezone text;
  v_booked_count integer;
  v_has_active_acquisition boolean := false;
  v_has_discipline_acquisition boolean := false;
  v_has_required_enrollment boolean := false;
  v_has_blocked_acquisition boolean := false;
  v_acquisition record;
  v_balance integer;
  v_blockers jsonb;
begin
  select *
    into v_session
  from public.class_sessions
  where id = target_session_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_found');
  end if;

  select *
    into v_student
  from public.students
  where id = target_student_id
    and studio_id = v_session.studio_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_found');
  end if;

  if v_student.lifecycle_status <> 'active' or not v_student.active then
    return jsonb_build_object('eligible', false, 'reason_code', 'student_not_operable');
  end if;

  if v_session.status <> 'scheduled'
     or (not p_allow_started_session and v_session.starts_at <= now()) then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_not_bookable');
  end if;

  if exists (
    select 1
    from public.reservations r
    where r.session_id = target_session_id
      and r.student_id = target_student_id
      and r.status in ('reserved', 'attended')
  ) then
    return jsonb_build_object('eligible', false, 'reason_code', 'already_reserved');
  end if;

  v_blockers := private.student_booking_blockers(target_student_id, target_session_id);

  if jsonb_array_length(coalesce(v_blockers, '[]'::jsonb)) > 0 then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', coalesce(v_blockers->0->>'code', 'account_restricted'),
      'restrictions', v_blockers
    );
  end if;

  select count(*)
    into v_booked_count
  from public.reservations r
  where r.session_id = target_session_id
    and r.status in ('reserved', 'attended');

  if v_booked_count >= v_session.capacity then
    return jsonb_build_object('eligible', false, 'reason_code', 'session_full');
  end if;

  select ct.discipline_id, greatest(coalesce(ct.credit_cost, 1), 1)
    into v_discipline_id, v_credit_cost
  from public.class_templates ct
  where ct.id = v_session.template_id;

  select timezone
    into v_timezone
  from public.studios
  where id = v_session.studio_id;

  v_class_date := (
    v_session.starts_at at time zone coalesce(v_timezone, 'America/Mexico_City')
  )::date;

  select *
    into v_policy
  from public.enrollment_policies
  where studio_id = v_session.studio_id;

  if found and v_policy.enabled and v_policy.required_for_booking then
    select exists (
      select 1
      from public.student_enrollments se
      where se.studio_id = v_session.studio_id
        and se.student_id = target_student_id
        and se.status = 'active'
        and se.starts_on <= v_class_date
        and (se.expires_on is null or se.expires_on >= v_class_date)
    )
      into v_has_required_enrollment;

    if not v_has_required_enrollment then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'enrollment_required',
        'credit_cost', v_credit_cost
      );
    end if;
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
  )
    into v_has_active_acquisition;

  if not v_has_active_acquisition then
    select exists (
      select 1
      from public.product_acquisitions pa
      where pa.studio_id = v_session.studio_id
        and pa.student_id = target_student_id
        and pa.status = 'active'
        and pa.access_blocked
    )
      into v_has_blocked_acquisition;

    if v_has_blocked_acquisition then
      return jsonb_build_object(
        'eligible', false,
        'reason_code', 'payment_pending',
        'credit_cost', v_credit_cost
      );
    end if;

    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'no_active_product',
      'credit_cost', v_credit_cost
    );
  end if;

  select exists (
    select 1
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and ptd.discipline_id = v_discipline_id
  )
    into v_has_discipline_acquisition;

  if not v_has_discipline_acquisition then
    return jsonb_build_object(
      'eligible', false,
      'reason_code', 'outside_product',
      'credit_cost', v_credit_cost
    );
  end if;

  for v_acquisition in
    select pa.id, pa.unlimited, pa.expires_on
    from public.product_acquisitions pa
    join public.product_template_disciplines ptd
      on ptd.product_template_id = pa.product_template_id
     and ptd.studio_id = pa.studio_id
    where pa.studio_id = v_session.studio_id
      and pa.student_id = target_student_id
      and pa.status = 'active'
      and not pa.access_blocked
      and (
        (pa.activation_mode = 'first_usage' and pa.starts_on is null)
        or (pa.starts_on <= v_class_date and pa.expires_on >= v_class_date)
      )
      and ptd.discipline_id = v_discipline_id
    order by
      pa.unlimited desc,
      coalesce(pa.expires_on, 'infinity'::date) asc,
      pa.created_at asc
  loop
    if v_acquisition.unlimited then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', true,
        'available_credits', null,
        'credit_cost', v_credit_cost
      );
    end if;

    select coalesce(sum(cl.quantity), 0)::integer
      into v_balance
    from public.credit_ledger cl
    where cl.acquisition_id = v_acquisition.id;

    if v_balance >= v_credit_cost then
      return jsonb_build_object(
        'eligible', true,
        'reason_code', null,
        'acquisition_id', v_acquisition.id,
        'unlimited', false,
        'available_credits', v_balance,
        'credit_cost', v_credit_cost
      );
    end if;
  end loop;

  return jsonb_build_object(
    'eligible', false,
    'reason_code', 'no_credits',
    'credit_cost', v_credit_cost
  );
end;
$function$
;
