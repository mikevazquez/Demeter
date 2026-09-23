
create or replace function private.activate_due_document_versions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
          on conflict (deduplication_key) do nothing;
        end if;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.activate_due_document_versions()
from public, anon, authenticated, service_role;
