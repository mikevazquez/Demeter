-- POLE-01-13 · Plantilla de evaluación por nivel generada desde el catálogo, sobre el motor
-- configurable EVALUACIONES-01/02 (schema_version 2). Sin motor nuevo.
-- Estructura aprobada por Mike (20 y 22-oct-2026):
--   1. Combo de evaluación · 40 % · weighted_criteria: Fuerza, Flexibilidad, Técnica y Líneas,
--      escala 1–10, 25 % cada uno. Las 4 figuras del combo se eligen al iniciar (POLE-01-14).
--   2. Figuras obligatorias · 30 % · meets: las obligatorias aprobadas del nivel, cada una
--      requisito para avanzar (Cumple / No cumple).
--   3. Nomenclatura · 30 % · correct_incorrect: 3 figuras dictadas distintas del combo,
--      Correcto / Incorrecto. Las figuras se eligen al iniciar (POLE-01-14).
--   Calificación aprobatoria = mínimo del paso (pole_level_settings).
-- Cada generación crea una versión nueva y la activa con la función del motor; las evaluaciones
-- iniciadas conservan su versión congelada.

create table if not exists public.pole_generated_templates (
  template_version_id uuid primary key,
  studio_id uuid not null,
  discipline_id uuid not null,
  level_key text not null
    check (level_key in ('beginner','intermediate','upper_intermediate','advanced')),
  template_id uuid not null,
  mandatory_figure_ids uuid[] not null,
  min_score numeric(5,2) not null,
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  foreign key (studio_id, template_version_id)
    references public.evaluation_template_versions(studio_id, id) on delete cascade,
  foreign key (studio_id, template_id)
    references public.evaluation_templates(studio_id, id) on delete cascade,
  foreign key (studio_id, discipline_id, level_key)
    references public.pole_level_settings(studio_id, discipline_id, level_key) on delete cascade
);

create index if not exists pole_generated_templates_level_idx
  on public.pole_generated_templates (studio_id, discipline_id, level_key, generated_at desc);

-- Rubric elements («skill» for combo criteria, «theory» for dictated figures) are ordinary
-- technical elements of the Pole discipline, reused by name.
create or replace function private.pole_rubric_element(
  p_studio uuid, p_discipline uuid, p_name text, p_kind text, p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id
  from public.technical_elements
  where studio_id = p_studio and discipline_id = p_discipline
    and pole_catalog_slug is null and lower(name) = lower(p_name);

  if v_id is null then
    insert into public.technical_elements (studio_id, discipline_id, name, element_kind, description, active)
    values (p_studio, p_discipline, p_name, p_kind, p_description, true)
    returning id into v_id;
  elsif not exists (select 1 from public.technical_elements where id = v_id and element_kind = p_kind) then
    raise exception 'pole_rubric_element_conflict';
  end if;
  return v_id;
end;
$$;
revoke all on function private.pole_rubric_element(uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function private.pole_generate_templates(p_studio uuid, p_discipline uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level record;
  v_label text;
  v_dtl uuid;
  v_template uuid;
  v_version uuid;
  v_number integer;
  v_block uuid;
  v_mandatory uuid[];
  v_proposed integer;
  v_last public.pole_generated_templates;
  v_result jsonb := '{}'::jsonb;
  v_sort integer;
  v_figure uuid;
  v_criterion record;
  v_question integer;
begin
  if auth.uid() is null or not private.has_capability(p_studio, 'evaluations.configure') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.disciplines where id = p_discipline and studio_id = p_studio) then
    raise exception 'forbidden';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pole_templates:' || p_studio::text || ':' || p_discipline::text, 0)
  );
  perform private.pole_ensure_level_settings(p_studio, p_discipline);

  for v_level in
    select s.level_key, s.catalog_level, s.min_score_to_advance
    from public.pole_level_settings s
    where s.studio_id = p_studio and s.discipline_id = p_discipline and s.level_key <> 'elite'
    order by array_position(array['beginner','intermediate','upper_intermediate','advanced'], s.level_key)
  loop
    v_label := case v_level.level_key
      when 'beginner' then 'Principiante'
      when 'intermediate' then 'Intermedio'
      when 'upper_intermediate' then 'Intermedio Avanzado'
      when 'advanced' then 'Avanzado'
    end;

    select array_agg(m.figure_element_id order by f.sort_order), count(*) filter (where m.status = 'proposed')
      into v_mandatory, v_proposed
    from public.pole_level_mandatory_figures m
    join public.pole_figure_profiles f on f.element_id = m.figure_element_id
    where m.studio_id = p_studio and m.discipline_id = p_discipline and m.level_key = v_level.level_key;

    if coalesce(cardinality(v_mandatory), 0) < 4 or v_proposed > 0 then
      v_result := v_result || jsonb_build_object(v_level.level_key, jsonb_build_object('status', 'mandatory_not_approved'));
      continue;
    end if;

    select dl.id into v_dtl
    from public.discipline_technical_levels dl
    join public.technical_level_definitions d on d.id = dl.technical_level_id and d.studio_id = dl.studio_id
    where dl.studio_id = p_studio and dl.discipline_id = p_discipline and d.level_key = v_level.level_key;

    if v_dtl is null then
      v_result := v_result || jsonb_build_object(v_level.level_key, jsonb_build_object('status', 'level_missing'));
      continue;
    end if;

    -- Nothing changed since the last generation that is still active: keep it.
    select g.* into v_last
    from public.pole_generated_templates g
    join public.evaluation_template_versions v on v.id = g.template_version_id and v.status = 'active'
    where g.studio_id = p_studio and g.discipline_id = p_discipline and g.level_key = v_level.level_key
    order by g.generated_at desc
    limit 1;

    if v_last.template_version_id is not null
       and v_last.mandatory_figure_ids = v_mandatory
       and v_last.min_score = v_level.min_score_to_advance then
      v_result := v_result || jsonb_build_object(v_level.level_key,
        jsonb_build_object('status', 'unchanged', 'template_version_id', v_last.template_version_id));
      continue;
    end if;

    -- Reuse the generated template for this level, else the level's existing template, else create.
    v_template := v_last.template_id;
    if v_template is null then
      select g.template_id into v_template
      from public.pole_generated_templates g
      join public.evaluation_templates t on t.id = g.template_id and t.archived_at is null
      where g.studio_id = p_studio and g.discipline_id = p_discipline and g.level_key = v_level.level_key
      order by g.generated_at desc
      limit 1;
    end if;
    if v_template is null then
      select t.id into v_template
      from public.evaluation_templates t
      where t.studio_id = p_studio and t.discipline_id = p_discipline
        and t.discipline_technical_level_id = v_dtl and t.archived_at is null
      order by t.updated_at desc
      limit 1;
    end if;
    if v_template is null then
      insert into public.evaluation_templates (studio_id, discipline_id, discipline_technical_level_id, name, created_by)
      values (p_studio, p_discipline, v_dtl, 'Pole · Evaluación ' || v_label, auth.uid())
      returning id into v_template;
    end if;

    select coalesce(max(version_number), 0) + 1 into v_number
    from public.evaluation_template_versions where template_id = v_template;

    insert into public.evaluation_template_versions (
      studio_id, template_id, version_number, status, pass_threshold, schema_version,
      evaluator_instructions, created_by
    )
    values (
      p_studio, v_template, v_number, 'draft', v_level.min_score_to_advance, 2,
      'Generada desde el catálogo de Pole (POLE-01). Combo 40 %, obligatorias 30 %, nomenclatura 30 %. '
      || 'Si falta una obligatoria la alumna no sube aunque alcance el mínimo.',
      auth.uid()
    )
    returning id into v_version;

    -- 1 · Combo de evaluación
    insert into public.evaluation_template_criteria (
      studio_id, template_version_id, criterion_key, label, description, weight_percent,
      sort_order, block_type, evaluator_instructions
    )
    values (
      p_studio, v_version, 'pole_combo', 'Combo de evaluación',
      'Combo de 4 figuras del nivel. Califica qué tan limpio se ejecuta.', 40, 1, 'weighted_criteria',
      'Escala 1–10 en cada criterio.'
    )
    returning id into v_block;

    v_sort := 0;
    for v_criterion in
      select * from (values
        ('Fuerza', 'Control y fuerza para entrar, sostener y salir de cada figura.'),
        ('Flexibilidad', 'Amplitud y extensión que pide cada figura.'),
        ('Técnica', 'Agarres, puntos de contacto y transiciones correctas.'),
        ('Líneas', 'Puntas, alineación y estética de las figuras.')
      ) c(name, description)
    loop
      v_sort := v_sort + 1;
      insert into public.evaluation_template_elements (
        studio_id, template_version_id, element_id, criterion_id, scored, max_score,
        sort_order, item_label, item_description, item_kind, item_weight_percent
      )
      values (
        p_studio, v_version,
        private.pole_rubric_element(p_studio, p_discipline, 'Combo · ' || v_criterion.name, 'skill', v_criterion.description),
        v_block, true, 10, v_sort, v_criterion.name, v_criterion.description, 'criterion', 25
      );
    end loop;

    -- 2 · Figuras obligatorias
    insert into public.evaluation_template_criteria (
      studio_id, template_version_id, criterion_key, label, description, weight_percent,
      sort_order, block_type, evaluator_instructions
    )
    values (
      p_studio, v_version, 'pole_mandatory', 'Figuras obligatorias',
      'Figuras llave para el siguiente nivel.', 30, 2, 'meets',
      'Cumple sólo si la ejecuta sin ayuda. Si falta una, la alumna no sube de nivel.'
    )
    returning id into v_block;

    foreach v_figure in array v_mandatory loop
      v_sort := v_sort + 1;
      insert into public.evaluation_template_elements (
        studio_id, template_version_id, element_id, criterion_id, mandatory, scored, max_score,
        sort_order, item_label, item_kind, progression_required
      )
      select p_studio, v_version, v_figure, v_block, true, false, 100, v_sort, e.name, 'element', true
      from public.technical_elements e where e.id = v_figure;
    end loop;

    -- 3 · Nomenclatura
    insert into public.evaluation_template_criteria (
      studio_id, template_version_id, criterion_key, label, description, weight_percent,
      sort_order, block_type, evaluator_instructions
    )
    values (
      p_studio, v_version, 'pole_nomenclature', 'Nomenclatura',
      'La coach dicta un combo de 3 figuras por nombre, distintas del combo de evaluación.', 30, 3,
      'correct_incorrect',
      'Sin demostración. Si no sabe cuál es la figura, no la sacó.'
    )
    returning id into v_block;

    for v_question in 1..3 loop
      v_sort := v_sort + 1;
      insert into public.evaluation_template_elements (
        studio_id, template_version_id, element_id, criterion_id, scored, max_score,
        sort_order, item_label, item_kind
      )
      values (
        p_studio, v_version,
        private.pole_rubric_element(p_studio, p_discipline, 'Figura dictada ' || v_question, 'theory',
          'Figura que la coach dicta por nombre al iniciar la evaluación.'),
        v_block, false, 100, v_sort, 'Figura dictada ' || v_question, 'question'
      );
    end loop;

    perform public.admin_activate_evaluation_template_version_v2(v_version);

    insert into public.pole_generated_templates (
      template_version_id, studio_id, discipline_id, level_key, template_id,
      mandatory_figure_ids, min_score, generated_by
    )
    values (
      v_version, p_studio, p_discipline, v_level.level_key, v_template,
      v_mandatory, v_level.min_score_to_advance, auth.uid()
    );

    v_result := v_result || jsonb_build_object(v_level.level_key,
      jsonb_build_object('status', 'generated', 'template_version_id', v_version, 'version_number', v_number));
  end loop;

  return v_result;
end;
$$;
revoke all on function private.pole_generate_templates(uuid, uuid) from public, anon, authenticated;
grant execute on function private.pole_generate_templates(uuid, uuid) to authenticated;

create or replace function public.staff_generate_pole_evaluation_templates(p_studio uuid, p_discipline uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.pole_generate_templates(p_studio, p_discipline); $$;
revoke all on function public.staff_generate_pole_evaluation_templates(uuid, uuid) from public, anon;
grant execute on function public.staff_generate_pole_evaluation_templates(uuid, uuid) to authenticated;

alter table public.pole_generated_templates enable row level security;
alter table public.pole_generated_templates force row level security;
revoke all on public.pole_generated_templates from public, anon, authenticated;
grant select on public.pole_generated_templates to authenticated;
drop policy if exists pole_generated_templates_staff_read on public.pole_generated_templates;
create policy pole_generated_templates_staff_read on public.pole_generated_templates
  for select to authenticated using (private.has_capability(studio_id, 'evaluations.read'));
