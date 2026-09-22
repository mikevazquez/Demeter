-- EVALUACIONES-01 · Result notification lifecycle.
-- Result history remains immutable. Read receipts live in a separate table.

create table if not exists public.student_evaluation_result_views (
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (student_id, evaluation_id)
);

create index if not exists student_evaluation_result_views_studio_idx
  on public.student_evaluation_result_views (studio_id, student_id, viewed_at desc);

-- Historical published results predate the notification feature, so treat them as already seen.
insert into public.student_evaluation_result_views (
  studio_id,
  student_id,
  evaluation_id,
  viewed_at
)
select
  e.studio_id,
  e.student_id,
  e.id,
  coalesce(e.published_at, e.updated_at, now())
from public.technical_evaluations e
where e.status = 'published'
on conflict (student_id, evaluation_id) do nothing;

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
    and not exists (
      select 1
      from public.student_evaluation_result_views v
      where v.student_id = e.student_id
        and v.evaluation_id = e.id
    )
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
  v_evaluation public.technical_evaluations;
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

  select e.* into v_evaluation
  from public.technical_evaluations e
  where e.id = p_evaluation_id
    and e.studio_id = v_student.studio_id
    and e.student_id = v_student.id
    and e.status = 'published';

  if v_evaluation.id is null then
    raise exception 'evaluation_result_not_found';
  end if;

  insert into public.student_evaluation_result_views (
    studio_id,
    student_id,
    evaluation_id,
    viewed_at
  )
  values (
    v_evaluation.studio_id,
    v_evaluation.student_id,
    v_evaluation.id,
    now()
  )
  on conflict (student_id, evaluation_id)
  do update set viewed_at = excluded.viewed_at;
end;
$$;

revoke all on table public.student_evaluation_result_views from public, anon, authenticated;

revoke all on function public.student_latest_unread_evaluation_result() from public, anon;
grant execute on function public.student_latest_unread_evaluation_result() to authenticated;

revoke all on function public.student_mark_evaluation_result_viewed(uuid) from public, anon;
grant execute on function public.student_mark_evaluation_result_viewed(uuid) to authenticated;

-- The old inline receipt column is intentionally retired. Published evaluations remain immutable.
drop trigger if exists technical_evaluations_reset_student_viewed_on_publish
  on public.technical_evaluations;

drop function if exists private.evaluations_reset_student_viewed_on_publish();

alter table public.technical_evaluations
  drop column if exists student_viewed_at;
