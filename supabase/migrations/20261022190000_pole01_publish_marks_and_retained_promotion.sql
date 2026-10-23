-- POLE-01-17 · POLE-01-18
-- Decisiones de Mike (20-oct-2026):
--  * Al publicar, las figuras aprobadas en la evaluación se marcan logradas en el perfil, sin
--    marcado adicional de la coach.
--  * Ascenso retenido: si la calificación alcanza el mínimo pero falta una obligatoria, la alumna
--    permanece; sube automáticamente cuando la coach marca esa figura como lograda en clase, sin
--    repetir la evaluación.
-- Figuras que cuentan como aprobadas al publicar (Notion POLE-01-17):
--  * obligatorias con «Cumple»;
--  * figuras dictadas con «Correcto»;
--  * las 4 figuras del combo cuando la calificación total alcanza el mínimo del paso.
-- Sólo aplica a evaluaciones de progresión generadas desde el catálogo (pole_generated_templates).

create table if not exists public.pole_retained_promotions (
  evaluation_id uuid primary key,
  studio_id uuid not null,
  student_id uuid not null,
  discipline_id uuid not null,
  from_level_id uuid not null,
  to_level_id uuid not null,
  missing_figure_ids uuid[] not null check (cardinality(missing_figure_ids) > 0),
  status text not null default 'retained' check (status in ('retained','released','superseded')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  check ((status = 'released') = (released_at is not null)),
  foreign key (studio_id, evaluation_id) references public.technical_evaluations(studio_id, id) on delete cascade
);

create index if not exists pole_retained_promotions_student_idx
  on public.pole_retained_promotions (studio_id, student_id, status);

-- One active retention per student and discipline.
create unique index if not exists pole_retained_promotions_active_uq
  on public.pole_retained_promotions (studio_id, student_id, discipline_id)
  where status = 'retained';

create or replace function private.pole_mark_achieved(
  p_studio uuid, p_student uuid, p_figure uuid, p_actor uuid, p_session uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_pole_figure_achievements
    (studio_id, student_id, figure_element_id, source, marked_by, class_session_id, achieved_at, validated_at)
  values (p_studio, p_student, p_figure, 'instructor', p_actor, p_session, now(), now())
  on conflict (studio_id, student_id, figure_element_id) do nothing;

  if found then
    insert into public.student_pole_figure_achievement_events
      (studio_id, student_id, figure_element_id, action, actor_user_id, class_session_id)
    values (p_studio, p_student, p_figure, 'marked', p_actor, p_session);
  end if;
end;
$$;
revoke all on function private.pole_mark_achieved(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.pole_on_evaluation_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generated public.pole_generated_templates;
  v_plan public.pole_evaluation_figure_plans;
  v_threshold numeric;
  v_actor uuid := coalesce(auth.uid(), new.evaluator_user_id, new.created_by);
  v_figure uuid;
  v_missing uuid[];
  v_other_failed boolean;
  v_next uuid;
  v_index integer;
begin
  if old.status = new.status or new.status <> 'published' then return new; end if;

  select * into v_generated from public.pole_generated_templates
  where template_version_id = new.template_version_id and studio_id = new.studio_id;
  if v_generated.template_version_id is null or v_actor is null then return new; end if;

  select pass_threshold into v_threshold
  from public.evaluation_template_versions where id = new.template_version_id;
  select * into v_plan from public.pole_evaluation_figure_plans where evaluation_id = new.id;

  -- Mandatory figures with «Cumple».
  for v_figure in
    select te.element_id
    from public.evaluation_template_elements te
    join public.evaluation_template_criteria c on c.id = te.criterion_id and c.criterion_key = 'pole_mandatory'
    join public.technical_evaluation_element_results r
      on r.template_element_id = te.id and r.evaluation_id = new.id and r.result_status = 'meets'
    where te.template_version_id = new.template_version_id
  loop
    perform private.pole_mark_achieved(new.studio_id, new.student_id, v_figure, v_actor, null);
  end loop;

  if v_plan.evaluation_id is not null then
    -- Dictated figures with «Correcto» (items in the same order as the plan).
    for v_index in 1..3 loop
      if exists (
        select 1
        from public.evaluation_template_elements te
        join public.evaluation_template_criteria c on c.id = te.criterion_id and c.criterion_key = 'pole_nomenclature'
        join public.technical_evaluation_element_results r
          on r.template_element_id = te.id and r.evaluation_id = new.id and r.result_status = 'meets'
        where te.template_version_id = new.template_version_id
          and te.item_label = 'Figura dictada ' || v_index
      ) then
        perform private.pole_mark_achieved(new.studio_id, new.student_id, v_plan.dictated_figure_ids[v_index], v_actor, null);
      end if;
    end loop;

    -- Combo figures when the total reaches the minimum.
    if coalesce(new.total_score, 0) >= v_threshold then
      foreach v_figure in array v_plan.combo_figure_ids loop
        perform private.pole_mark_achieved(new.studio_id, new.student_id, v_figure, v_actor, null);
      end loop;
    end if;
  end if;

  -- Retained promotion: minimum reached, only mandatory figures missing.
  if new.evaluation_purpose = 'progression' and new.final_outcome = 'stays'
     and coalesce(new.total_score, 0) >= v_threshold then
    select array_agg(te.element_id order by te.sort_order) into v_missing
    from public.evaluation_template_elements te
    join public.evaluation_template_criteria c on c.id = te.criterion_id and c.criterion_key = 'pole_mandatory'
    left join public.technical_evaluation_element_results r
      on r.template_element_id = te.id and r.evaluation_id = new.id
    where te.template_version_id = new.template_version_id
      and coalesce(r.result_status, 'not_evaluated') <> 'meets'
      and not exists (
        select 1 from public.student_pole_figure_achievements a
        where a.studio_id = new.studio_id and a.student_id = new.student_id and a.figure_element_id = te.element_id
      );

    -- Any other block below its own minimum means a regular «stays».
    select exists (
      select 1 from public.technical_evaluation_criterion_results cr
      join public.evaluation_template_criteria c on c.id = cr.template_criterion_id
      where cr.evaluation_id = new.id and c.criterion_key <> 'pole_mandatory' and cr.passed = false
    ) into v_other_failed;

    if coalesce(cardinality(v_missing), 0) > 0 and not v_other_failed then
      select next_level.id into v_next
      from public.discipline_technical_levels current_level
      join public.discipline_technical_levels next_level
        on next_level.studio_id = current_level.studio_id
       and next_level.discipline_id = current_level.discipline_id
       and next_level.active
       and next_level.discipline_order > current_level.discipline_order
      where current_level.id = coalesce(new.current_discipline_level_id_at_start, new.target_discipline_level_id)
      order by next_level.discipline_order
      limit 1;

      if v_next is not null then
        update public.pole_retained_promotions set status = 'superseded'
        where studio_id = new.studio_id and student_id = new.student_id
          and discipline_id = new.discipline_id and status = 'retained';

        insert into public.pole_retained_promotions
          (evaluation_id, studio_id, student_id, discipline_id, from_level_id, to_level_id, missing_figure_ids)
        values
          (new.id, new.studio_id, new.student_id, new.discipline_id,
           coalesce(new.current_discipline_level_id_at_start, new.target_discipline_level_id), v_next, v_missing)
        on conflict (evaluation_id) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.pole_on_evaluation_published() from public, anon, authenticated;

drop trigger if exists pole_on_evaluation_published on public.technical_evaluations;
create trigger pole_on_evaluation_published
  after update of status on public.technical_evaluations
  for each row execute function private.pole_on_evaluation_published();

-- When the coach marks a missing mandatory figure, release the retained promotion once all
-- missing figures are achieved.
create or replace function private.pole_release_retained()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r public.pole_retained_promotions;
begin
  for r in
    select * from public.pole_retained_promotions p
    where p.studio_id = new.studio_id and p.student_id = new.student_id and p.status = 'retained'
      and new.figure_element_id = any(p.missing_figure_ids)
    for update
  loop
    if not exists (
      select 1 from unnest(r.missing_figure_ids) x
      where not exists (
        select 1 from public.student_pole_figure_achievements a
        where a.studio_id = r.studio_id and a.student_id = r.student_id and a.figure_element_id = x
      )
    ) then
      -- The level only moves forward if the student is still on the level of that evaluation.
      if exists (
        select 1 from public.student_discipline_levels s
        where s.studio_id = r.studio_id and s.student_id = r.student_id and s.discipline_id = r.discipline_id
          and s.discipline_technical_level_id = r.from_level_id
      ) then
        update public.student_discipline_levels
        set discipline_technical_level_id = r.to_level_id,
            effective_from = current_date,
            source_evaluation_id = r.evaluation_id,
            updated_at = now()
        where studio_id = r.studio_id and student_id = r.student_id and discipline_id = r.discipline_id;

        update public.pole_retained_promotions
        set status = 'released', released_at = now(), released_by = auth.uid()
        where evaluation_id = r.evaluation_id;
      else
        update public.pole_retained_promotions set status = 'superseded'
        where evaluation_id = r.evaluation_id;
      end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.pole_release_retained() from public, anon, authenticated;

drop trigger if exists pole_release_retained on public.student_pole_figure_achievements;
create trigger pole_release_retained
  after insert on public.student_pole_figure_achievements
  for each row execute function private.pole_release_retained();

alter table public.pole_retained_promotions enable row level security;
alter table public.pole_retained_promotions force row level security;
revoke all on public.pole_retained_promotions from public, anon, authenticated;
grant select on public.pole_retained_promotions to authenticated;
drop policy if exists pole_retained_promotions_staff_read on public.pole_retained_promotions;
create policy pole_retained_promotions_staff_read on public.pole_retained_promotions
  for select to authenticated using (private.has_capability(studio_id, 'evaluations.read'));
drop policy if exists pole_retained_promotions_self_read on public.pole_retained_promotions;
create policy pole_retained_promotions_self_read on public.pole_retained_promotions
  for select to authenticated using (private.is_current_student(student_id, studio_id));
