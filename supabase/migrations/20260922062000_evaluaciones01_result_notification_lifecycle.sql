-- EVALUACIONES-01 · Result notification lifecycle.
-- Existing published results are historical, not new notifications.
-- A result is surfaced on Home only when it is the newest evaluation for that discipline.

update public.technical_evaluations
set student_viewed_at = coalesce(student_viewed_at, published_at, updated_at)
where status = 'published'
  and student_viewed_at is null;

create or replace function public.student_latest_unread_evaluation_result()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = auth.uid()
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if v_student.id is null then
    raise exception 'student_context_not_found';
  end if;

  if not private.has_capability(v_student.studio_id, 'student.portal') then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'discipline_name', d.name,
    'evaluated_level_title', target_def.title,
    'evaluation_date', e.evaluation_date,
    'total_score', e.total_score,
    'final_outcome', e.final_outcome,
    'published_at', e.published_at
  )
  into v_result
  from public.technical_evaluations e
  join public.disciplines d on d.id = e.discipline_id
  join public.discipline_technical_levels target_dl
    on target_dl.id = e.target_discipline_level_id
  join public.technical_level_definitions target_def
    on target_def.id = target_dl.technical_level_id
  where e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published'
    and e.student_viewed_at is null
    and not exists (
      select 1
      from public.technical_evaluations newer
      where newer.studio_id = e.studio_id
        and newer.student_id = e.student_id
        and newer.discipline_id = e.discipline_id
        and newer.created_at > e.created_at
        and newer.status <> 'published'
    )
  order by e.published_at desc nulls last, e.evaluation_date desc, e.created_at desc
  limit 1;

  return v_result;
end;
$$;

create or replace function private.evaluations_reset_student_viewed_on_publish()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    new.student_viewed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists technical_evaluations_reset_student_viewed_on_publish
  on public.technical_evaluations;

create trigger technical_evaluations_reset_student_viewed_on_publish
before update of status on public.technical_evaluations
for each row
execute function private.evaluations_reset_student_viewed_on_publish();

revoke all on function public.student_latest_unread_evaluation_result() from public, anon;
grant execute on function public.student_latest_unread_evaluation_result() to authenticated;
