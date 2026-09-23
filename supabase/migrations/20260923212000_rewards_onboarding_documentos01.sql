-- REWARDS · DOCUMENTOS-01 integration
-- Step 1 is completed only when every current, applicable, mandatory
-- document requirement has real acceptance evidence.

create or replace function private.reward_onboarding_refresh_documents(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_required_count integer := 0;
  v_satisfied_count integer := 0;
  v_versions jsonb := '[]'::jsonb;
begin
  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then return; end if;

  insert into public.reward_onboarding(studio_id, student_id)
  values (v_student.studio_id, v_student.id)
  on conflict (studio_id, student_id) do nothing;

  with current_required as (
    select
      dv.id as version_id,
      dv.document_id,
      dv.version_number,
      d.name,
      private.document_requirement_satisfied(dv.id, v_student.id) as satisfied
    from public.document_versions dv
    join public.studio_documents d on d.id = dv.document_id
    where dv.studio_id = v_student.studio_id
      and dv.status in ('active','scheduled')
      and dv.published_at is not null
      and coalesce(dv.effective_at,dv.published_at) <= now()
      and dv.retired_at is null
      and d.archived_at is null
      and dv.response_mode = 'accept_required'
      and private.document_version_applies_to_student(dv.id,v_student.id,null)
      and not exists (
        select 1
        from public.document_versions newer
        where newer.document_id = dv.document_id
          and newer.version_number > dv.version_number
          and newer.status in ('active','scheduled')
          and newer.published_at is not null
          and coalesce(newer.effective_at,newer.published_at) <= now()
          and newer.retired_at is null
      )
  )
  select
    count(*)::integer,
    count(*) filter (where satisfied)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'document_id', document_id,
          'version_id', version_id,
          'version_number', version_number,
          'name', name,
          'satisfied', satisfied
        )
        order by name, version_number
      ),
      '[]'::jsonb
    )
  into v_required_count, v_satisfied_count, v_versions
  from current_required;

  if v_required_count > 0 and v_satisfied_count = v_required_count then
    update public.reward_onboarding
    set documents_completed_at = coalesce(documents_completed_at, clock_timestamp()),
        documents_evidence = case
          when documents_completed_at is null then
            jsonb_build_object(
              'required_count', v_required_count,
              'satisfied_count', v_satisfied_count,
              'versions', v_versions,
              'source', 'documentos01'
            )
          else documents_evidence
        end,
        updated_at = clock_timestamp()
    where studio_id = v_student.studio_id
      and student_id = v_student.id;
  elsif exists (
    select 1
    from public.reward_onboarding
    where studio_id = v_student.studio_id
      and student_id = v_student.id
      and documents_completed_at is null
  ) then
    update public.reward_onboarding
    set documents_evidence = jsonb_build_object(
          'required_count', v_required_count,
          'satisfied_count', v_satisfied_count,
          'versions', v_versions,
          'source', 'documentos01'
        ),
        updated_at = clock_timestamp()
    where studio_id = v_student.studio_id
      and student_id = v_student.id
      and documents_completed_at is null;
  end if;

  perform private.reward_onboarding_try_unlock(v_student.id);
end;
$$;

revoke all on function private.reward_onboarding_refresh_documents(uuid)
from public, anon, authenticated, service_role;

create or replace function private.reward_onboarding_from_document_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reward_onboarding_refresh_documents(new.student_id);
  return new;
end;
$$;

revoke all on function private.reward_onboarding_from_document_acceptance()
from public, anon, authenticated, service_role;

drop trigger if exists reward_onboarding_document_acceptance on public.document_acceptances;
create trigger reward_onboarding_document_acceptance
after insert on public.document_acceptances
for each row
execute function private.reward_onboarding_from_document_acceptance();

do $$
declare
  v_student record;
begin
  for v_student in
    select s.id
    from public.students s
    where s.active
  loop
    perform private.reward_onboarding_refresh_documents(v_student.id);
  end loop;
end
$$;
