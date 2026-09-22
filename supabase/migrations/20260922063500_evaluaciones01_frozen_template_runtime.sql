-- EVALUACIONES-01 · Allow an in-progress evaluation to finish with its frozen template.
-- New evaluations still require an active template. Existing evaluations may keep the
-- same template version even if that version is later archived.

create or replace function private.evaluations_validate_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student record;
  v_template record;
  v_current_level uuid;
begin
  if new.student_id is null then
    raise exception 'evaluation_student_required';
  end if;

  select studio_id, full_name
    into v_student
  from public.students
  where id = new.student_id;

  if v_student.studio_id is distinct from new.studio_id then
    raise exception 'evaluation_student_studio_mismatch';
  end if;

  new.student_name_snapshot := coalesce(nullif(trim(new.student_name_snapshot), ''), v_student.full_name);

  if not exists (
    select 1 from public.discipline_technical_levels dl
    where dl.id = new.target_discipline_level_id
      and dl.studio_id = new.studio_id
      and dl.discipline_id = new.discipline_id
      and dl.active
  ) then
    raise exception 'evaluation_target_level_mismatch';
  end if;

  select
    v.status as version_status,
    t.studio_id,
    t.discipline_id,
    t.discipline_technical_level_id
  into v_template
  from public.evaluation_template_versions v
  join public.evaluation_templates t on t.id = v.template_id
  where v.id = new.template_version_id;

  if v_template.studio_id is distinct from new.studio_id
     or v_template.discipline_id is distinct from new.discipline_id
     or v_template.discipline_technical_level_id is distinct from new.target_discipline_level_id then
    raise exception 'evaluation_template_target_mismatch';
  end if;

  if v_template.version_status <> 'active'
     and (
       tg_op = 'INSERT'
       or new.template_version_id is distinct from old.template_version_id
     ) then
    raise exception 'evaluation_template_version_not_active';
  end if;

  if new.evaluator_user_id is not null and not exists (
    select 1 from public.studio_memberships sm
    where sm.studio_id = new.studio_id
      and sm.user_id = new.evaluator_user_id
      and sm.active
  ) then
    raise exception 'evaluation_evaluator_not_active_member';
  end if;

  if new.current_discipline_level_id_at_start is null then
    select sdl.discipline_technical_level_id
      into v_current_level
    from public.student_discipline_levels sdl
    where sdl.studio_id = new.studio_id
      and sdl.student_id = new.student_id
      and sdl.discipline_id = new.discipline_id;

    new.current_discipline_level_id_at_start := v_current_level;
  end if;

  new.last_saved_at := now();
  return new;
end;
$$;
