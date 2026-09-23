
-- DOCUMENTOS-01 · administrative tracking projections

create or replace function public.admin_document_tracking(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
  v_result jsonb := '[]'::jsonb;
  v_student record;
  v_guardian record;
  v_acceptance record;
  v_satisfied boolean;
  v_student_completed boolean;
  v_guardian_completed boolean;
  v_minor boolean;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select * into v_version
  from public.document_versions
  where id=p_version_id;

  if not found then raise exception 'document_version_not_found'; end if;
  if not private.has_capability(v_version.studio_id,'documents.read') then raise exception 'forbidden'; end if;

  for v_student in
    select s.id,s.full_name,s.email,s.phone
    from public.students s
    where s.studio_id=v_version.studio_id
      and s.active
      and s.lifecycle_status='active'
    order by s.full_name
  loop
    if not private.document_version_applies_to_student(p_version_id,v_student.id,null) then
      continue;
    end if;

    v_satisfied := private.document_requirement_satisfied(p_version_id,v_student.id);
    v_student_completed := private.document_party_satisfied(p_version_id,v_student.id,'student');
    v_guardian_completed := private.document_party_satisfied(p_version_id,v_student.id,'guardian');
    v_minor := private.student_is_minor(v_student.id,current_date);

    select g.id,g.full_name,g.relationship
      into v_guardian
    from public.student_guardians g
    where g.studio_id=v_version.studio_id
      and g.student_id=v_student.id
      and g.active
    order by g.created_at desc
    limit 1;

    select a.id,a.accepted_at,a.acceptor_kind,a.decision,a.method
      into v_acceptance
    from public.document_acceptances a
    where a.version_id=p_version_id
      and a.student_id=v_student.id
      and not exists (
        select 1 from public.document_acceptance_invalidations i where i.acceptance_id=a.id
      )
    order by a.accepted_at desc
    limit 1;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'student_id',v_student.id,
        'full_name',v_student.full_name,
        'email',v_student.email,
        'phone',v_student.phone,
        'minor',v_minor,
        'satisfied',v_satisfied,
        'student_completed',v_student_completed,
        'guardian_completed',v_guardian_completed,
        'guardian',case when v_guardian.id is null then null else jsonb_build_object(
          'id',v_guardian.id,'full_name',v_guardian.full_name,'relationship',v_guardian.relationship
        ) end,
        'latest_acceptance',case when v_acceptance.id is null then null else jsonb_build_object(
          'id',v_acceptance.id,'accepted_at',v_acceptance.accepted_at,
          'acceptor_kind',v_acceptance.acceptor_kind,'decision',v_acceptance.decision,'method',v_acceptance.method
        ) end,
        'blocks_booking',v_version.enforcement_scope='global_booking' and not v_satisfied
      )
    );
  end loop;

  return v_result;
end;
$$;

revoke all on function public.admin_document_tracking(uuid)
from public, anon, authenticated;
grant execute on function public.admin_document_tracking(uuid)
to authenticated;

create or replace function public.admin_document_publish_impact(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tracking jsonb;
  v_total integer := 0;
  v_completed integer := 0;
  v_pending integer := 0;
  v_minors integer := 0;
  v_guardian_pending integer := 0;
  v_blocked integer := 0;
begin
  v_tracking := public.admin_document_tracking(p_version_id);

  select
    count(*)::integer,
    count(*) filter (where coalesce((item->>'satisfied')::boolean,false))::integer,
    count(*) filter (where not coalesce((item->>'satisfied')::boolean,false))::integer,
    count(*) filter (where (item->>'minor')::boolean is true)::integer,
    count(*) filter (
      where (item->>'minor')::boolean is true
        and not coalesce((item->>'guardian_completed')::boolean,false)
    )::integer,
    count(*) filter (where coalesce((item->>'blocks_booking')::boolean,false))::integer
  into v_total,v_completed,v_pending,v_minors,v_guardian_pending,v_blocked
  from jsonb_array_elements(v_tracking) item;

  return jsonb_build_object(
    'total',v_total,
    'completed',v_completed,
    'pending',v_pending,
    'minors',v_minors,
    'guardian_pending',v_guardian_pending,
    'booking_blocked',v_blocked
  );
end;
$$;

revoke all on function public.admin_document_publish_impact(uuid)
from public, anon, authenticated;
grant execute on function public.admin_document_publish_impact(uuid)
to authenticated;
