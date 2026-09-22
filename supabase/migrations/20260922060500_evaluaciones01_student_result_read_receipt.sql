-- EVALUACIONES-01 · Student result read receipt.
-- Keeps the home result card as a one-time notification while preserving history.

alter table public.technical_evaluations
  add column if not exists student_viewed_at timestamptz;

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
  order by e.published_at desc nulls last, e.evaluation_date desc, e.created_at desc
  limit 1;

  return v_result;
end;
$$;

create or replace function public.student_mark_evaluation_result_viewed(
  p_evaluation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
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

  update public.technical_evaluations e
  set student_viewed_at = coalesce(e.student_viewed_at, now()),
      updated_at = now()
  where e.id = p_evaluation_id
    and e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published';

  if not found then
    raise exception 'evaluation_result_not_found';
  end if;
end;
$$;

revoke all on function public.student_latest_unread_evaluation_result() from public, anon;
grant execute on function public.student_latest_unread_evaluation_result() to authenticated;

revoke all on function public.student_mark_evaluation_result_viewed(uuid) from public, anon;
grant execute on function public.student_mark_evaluation_result_viewed(uuid) to authenticated;
