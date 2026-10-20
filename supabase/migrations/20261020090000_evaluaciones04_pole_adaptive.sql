-- EVALUACIONES-04 · Evaluación adaptativa de Pole.
-- Sandbox first. Do not promote to production without explicit approval.
--
-- 1. Parte personalizada: al crear una evaluación (diagnóstico o progresión, desde Hoy o
--    desde el perfil de la alumna) se agregan hasta 3 figuras por grupo:
--      pending_previous · no las cumplió en su evaluación anterior
--      self_marked      · las marcó ella en su portal y nadie las ha validado
--      next_level       · figuras del siguiente nivel con todos sus pasos previos logrados
--    No cuentan para el resultado del nivel: la plantilla sigue decidiendo el ascenso.
-- 2. Al publicar, lo que salió "Cumple" (plantilla + parte personalizada) queda como figura
--    lograda y validada en el progreso de la alumna.
-- 3. Plantillas base de Pole: una por nivel, armadas desde el programa base del catálogo.
--
-- Usa el dominio canónico de Catálogo C1/C2 de Sandbox; no crea otra tabla de logros.

-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------

create table public.technical_evaluation_personal_items (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  evaluation_id uuid not null references public.technical_evaluations(id) on delete cascade,
  element_id uuid not null references public.pole_figure_profiles(element_id) on delete cascade,
  reason text not null check (reason in ('pending_previous', 'self_marked', 'next_level')),
  sort_order smallint not null check (sort_order > 0),
  result_status text not null default 'not_evaluated'
    check (result_status in ('meets', 'does_not_meet', 'not_evaluated')),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  notes text,
  evaluated_by uuid references auth.users(id) on delete set null,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, element_id)
);

create index technical_evaluation_personal_items_evaluation_idx
on public.technical_evaluation_personal_items (evaluation_id, reason, sort_order);

create index technical_evaluation_personal_items_studio_idx
on public.technical_evaluation_personal_items (studio_id);

create index technical_evaluation_personal_items_element_idx
on public.technical_evaluation_personal_items (element_id);

alter table public.technical_evaluation_personal_items enable row level security;
alter table public.technical_evaluation_personal_items force row level security;
revoke all on public.technical_evaluation_personal_items from anon, authenticated;
grant select on public.technical_evaluation_personal_items to authenticated;

create policy technical_evaluation_personal_items_staff_read
on public.technical_evaluation_personal_items
for select
to authenticated
using (private.has_capability(studio_id, 'evaluations.read'));

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

-- Nivel de catálogo de un nivel técnico de disciplina (mapeo del estudio o por defecto).
create or replace function private.pole_catalog_level_for(
  p_studio_id uuid,
  p_discipline_level_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case tld.level_key
    when 'beginner' then 'principiante'
    when 'intermediate' then 'intermedio'
    when 'upper_intermediate' then 'intermedio'
    when 'advanced' then 'avanzado'
    when 'elite' then 'avanzado'
    else null
  end
  from public.discipline_technical_levels dtl
  join public.technical_level_definitions tld
    on tld.id = dtl.technical_level_id and tld.studio_id = dtl.studio_id
  where dtl.id = p_discipline_level_id
    and dtl.studio_id = p_studio_id;
$$;

-- Siguiente nivel técnico activo de la disciplina, o null si es el último.
create or replace function private.evaluations_next_level(p_discipline_level_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select next_level.id
  from public.discipline_technical_levels current_level
  join public.discipline_technical_levels next_level
    on next_level.studio_id = current_level.studio_id
   and next_level.discipline_id = current_level.discipline_id
   and next_level.active = true
   and next_level.discipline_order > current_level.discipline_order
  where current_level.id = p_discipline_level_id
  order by next_level.discipline_order
  limit 1;
$$;

-- Genera la parte personalizada de una evaluación. Devuelve cuántas figuras agregó.
-- Idempotente: no duplica figuras ya agregadas.
create or replace function private.evaluation_pole_generate_personal_items(
  p_evaluation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eval public.technical_evaluations;
  v_used uuid[];
  v_picked uuid[];
  v_next_level uuid;
  v_next_catalog text;
  v_count integer := 0;
  v_sort integer;
begin
  select * into v_eval from public.technical_evaluations where id = p_evaluation_id for update;
  if v_eval.id is null or v_eval.student_id is null or v_eval.status <> 'draft' then
    return 0;
  end if;

  -- Sólo disciplinas con catálogo de figuras.
  if not exists (
    select 1 from public.pole_figure_profiles pfp
    where pfp.studio_id = v_eval.studio_id and pfp.discipline_id = v_eval.discipline_id
  ) then
    return 0;
  end if;

  -- Lo que ya califica la plantilla y lo que ya está en la parte personalizada.
  select coalesce(array_agg(x.element_id), '{}'::uuid[]) into v_used
  from (
    select te.element_id
    from public.evaluation_template_elements te
    where te.template_version_id = v_eval.template_version_id
    union
    select pi.element_id
    from public.technical_evaluation_personal_items pi
    where pi.evaluation_id = v_eval.id
  ) x;

  select coalesce(max(pi.sort_order), 0) into v_sort
  from public.technical_evaluation_personal_items pi
  where pi.evaluation_id = v_eval.id;

  -- 1) Pendientes de su evaluación publicada más reciente de un día anterior.
  with previous as (
    select e.id
    from public.technical_evaluations e
    where e.studio_id = v_eval.studio_id
      and e.student_id = v_eval.student_id
      and e.discipline_id = v_eval.discipline_id
      and e.status = 'published'
      and e.id <> v_eval.id
      and e.evaluation_date < v_eval.evaluation_date
    order by e.evaluation_date desc, e.published_at desc nulls last
    limit 1
  ),
  failed as (
    select te.element_id, te.sort_order::integer as ord
    from previous p
    join public.technical_evaluation_element_results er on er.evaluation_id = p.id
    join public.evaluation_template_elements te on te.id = er.template_element_id
    where er.result_status = 'does_not_meet'
    union all
    select pi.element_id, 1000 + pi.sort_order
    from previous p
    join public.technical_evaluation_personal_items pi on pi.evaluation_id = p.id
    where pi.result_status = 'does_not_meet'
  ),
  candidates as (
    select f.element_id, min(f.ord) as ord
    from failed f
    join public.pole_figure_profiles pfp
      on pfp.element_id = f.element_id
     and pfp.studio_id = v_eval.studio_id
     and pfp.discipline_id = v_eval.discipline_id
    join public.technical_elements tel on tel.id = f.element_id and tel.active
    where not (f.element_id = any (v_used))
    group by f.element_id
    order by min(f.ord)
    limit greatest(0, 3 - (select count(*) from public.technical_evaluation_personal_items pi
      where pi.evaluation_id = v_eval.id and pi.reason = 'pending_previous'))
  )
  select coalesce(array_agg(c.element_id order by c.ord), '{}'::uuid[]) into v_picked
  from candidates c;

  insert into public.technical_evaluation_personal_items
    (studio_id, evaluation_id, element_id, reason, sort_order)
  select v_eval.studio_id, v_eval.id, x.element_id, 'pending_previous', v_sort + x.n
  from unnest(v_picked) with ordinality as x(element_id, n);
  v_used := v_used || v_picked;
  v_sort := v_sort + coalesce(array_length(v_picked, 1), 0);
  v_count := v_count + coalesce(array_length(v_picked, 1), 0);

  -- 2) Marcadas por ella sin validar (las más recientes primero).
  select coalesce(array_agg(c.element_id order by c.achieved_at desc), '{}'::uuid[]) into v_picked
  from (
    select a.figure_element_id as element_id, a.achieved_at
    from public.student_pole_figure_achievements a
    join public.pole_figure_profiles pfp
      on pfp.element_id = a.figure_element_id
     and pfp.discipline_id = v_eval.discipline_id
    join public.technical_elements tel on tel.id = a.figure_element_id and tel.active
    where a.studio_id = v_eval.studio_id
      and a.student_id = v_eval.student_id
      and a.source = 'student'
      and a.validated_at is null
      and not (a.figure_element_id = any (v_used))
    order by a.achieved_at desc
    limit greatest(0, 3 - (select count(*) from public.technical_evaluation_personal_items pi
      where pi.evaluation_id = v_eval.id and pi.reason = 'self_marked'))
  ) c;

  insert into public.technical_evaluation_personal_items
    (studio_id, evaluation_id, element_id, reason, sort_order)
  select v_eval.studio_id, v_eval.id, x.element_id, 'self_marked', v_sort + x.n
  from unnest(v_picked) with ordinality as x(element_id, n);
  v_used := v_used || v_picked;
  v_sort := v_sort + coalesce(array_length(v_picked, 1), 0);
  v_count := v_count + coalesce(array_length(v_picked, 1), 0);

  -- 3) Siguiente nivel: programa base, nunca Profesional, pasos previos completos.
  v_next_level := private.evaluations_next_level(v_eval.target_discipline_level_id);
  if v_next_level is not null then
    v_next_catalog := private.pole_catalog_level_for(v_eval.studio_id, v_next_level);
  end if;

  if v_next_catalog is not null and v_next_catalog <> 'profesional' then
    select coalesce(array_agg(c.element_id order by c.preferred desc, c.sort_order), '{}'::uuid[])
      into v_picked
    from (
      select pfp.element_id, pfp.sort_order,
             (pfp.figure_type in ('Giro', 'Invertida')) as preferred
      from public.pole_figure_profiles pfp
      join public.technical_elements tel on tel.id = pfp.element_id and tel.active
      where pfp.studio_id = v_eval.studio_id
        and pfp.discipline_id = v_eval.discipline_id
        and pfp.catalog_level = v_next_catalog
        and pfp.in_core_program
        and not (pfp.element_id = any (v_used))
        and exists (
          select 1 from public.pole_figure_prerequisites p
          where p.figure_element_id = pfp.element_id
        )
        and not exists (
          select 1 from public.student_pole_figure_achievements a
          where a.student_id = v_eval.student_id and a.figure_element_id = pfp.element_id
        )
        and not exists (
          select 1
          from public.pole_figure_prerequisites p
          where p.figure_element_id = pfp.element_id
            and not exists (
              select 1 from public.student_pole_figure_achievements a
              where a.student_id = v_eval.student_id and a.figure_element_id = p.required_element_id
            )
        )
      order by (pfp.figure_type in ('Giro', 'Invertida')) desc, pfp.sort_order
      limit greatest(0, 3 - (select count(*) from public.technical_evaluation_personal_items pi
      where pi.evaluation_id = v_eval.id and pi.reason = 'next_level'))
    ) c;

    insert into public.technical_evaluation_personal_items
      (studio_id, evaluation_id, element_id, reason, sort_order)
    select v_eval.studio_id, v_eval.id, x.element_id, 'next_level', v_sort + x.n
    from unnest(v_picked) with ordinality as x(element_id, n);
    v_count := v_count + coalesce(array_length(v_picked, 1), 0);
  end if;

  return v_count;
end;
$$;

-- Al crear la evaluación (cualquier camino: Hoy, perfil, siguiente paso del diagnóstico).
-- Si algo falla, la evaluación se crea igual, sin parte personalizada.
create or replace function private.technical_evaluations_after_insert_pole()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.evaluation_pole_generate_personal_items(new.id);
  exception when others then
    raise warning 'evaluation_pole_personal_items_failed: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger technical_evaluations_pole_personal_items
after insert on public.technical_evaluations
for each row execute function private.technical_evaluations_after_insert_pole();

-- Al publicar, todo lo que cumple queda validado en el progreso de figuras.
create or replace function private.technical_evaluations_after_publish_pole()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_element_id uuid;
begin
  if not (old.status = 'draft' and new.status = 'published') or new.student_id is null then
    return null;
  end if;

  select r.session_id into v_session_id
  from public.evaluation_invitations ei
  join public.reservations r on r.id = ei.reservation_id
  where ei.id = new.evaluation_invitation_id;

  for v_element_id in
    select te.element_id
    from public.technical_evaluation_element_results er
    join public.evaluation_template_elements te on te.id = er.template_element_id
    join public.pole_figure_profiles pfp
      on pfp.element_id = te.element_id and pfp.studio_id = new.studio_id
    where er.evaluation_id = new.id
      and er.result_status = 'meets'
    union
    select pi.element_id
    from public.technical_evaluation_personal_items pi
    where pi.evaluation_id = new.id
      and pi.result_status = 'meets'
  loop
    insert into public.student_pole_figure_achievements
      (studio_id, student_id, figure_element_id, source, marked_by, validated_at, class_session_id)
    values
      (new.studio_id, new.student_id, v_element_id, 'instructor', (select auth.uid()),
       now(), v_session_id)
    on conflict (studio_id, student_id, figure_element_id) do update
    set source = 'instructor',
        marked_by = excluded.marked_by,
        validated_at = excluded.validated_at,
        class_session_id = coalesce(excluded.class_session_id, public.student_pole_figure_achievements.class_session_id);
    -- El trigger canónico private.pole_audit conserva actor, fecha y los bytes del logro.

  end loop;

  return null;
end;
$$;

create trigger technical_evaluations_pole_publish_sync
after update of status on public.technical_evaluations
for each row execute function private.technical_evaluations_after_publish_pole();

-- ---------------------------------------------------------------------------
-- RPC · instructora
-- ---------------------------------------------------------------------------

create or replace function public.staff_save_evaluation_personal_item(
  p_item_id uuid,
  p_result_status text,
  p_attempt_count integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.technical_evaluation_personal_items;
  v_status text;
begin
  select * into v_item
  from public.technical_evaluation_personal_items
  where id = p_item_id;

  if v_item.id is null then
    raise exception 'evaluation_personal_item_not_found';
  end if;

  if (select auth.uid()) is null then
    raise exception 'evaluation_access_denied';
  end if;

  perform private.evaluations_require_capability(v_item.studio_id, 'evaluations.write');

  select e.status into v_status
  from public.technical_evaluations e
  where e.id = v_item.evaluation_id
    and e.studio_id = v_item.studio_id
  for update;

  -- Refresh pudo retirar el ítem mientras esperábamos el bloqueo del padre.
  perform 1 from public.technical_evaluation_personal_items where id = p_item_id for update;
  if not found then
    raise exception 'evaluation_personal_item_not_found';
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'evaluation_not_editable';
  end if;

  if p_result_status is null or p_result_status not in ('meets', 'does_not_meet', 'not_evaluated') then
    raise exception 'evaluation_personal_item_invalid_status';
  end if;

  if p_attempt_count is not null and (p_attempt_count < 0 or p_attempt_count > 20) then
    raise exception 'evaluation_personal_item_invalid_attempts';
  end if;

  update public.technical_evaluation_personal_items
  set result_status = p_result_status,
      attempt_count = coalesce(p_attempt_count, attempt_count),
      notes = nullif(trim(coalesce(p_notes, notes, '')), ''),
      evaluated_by = case when p_result_status = 'not_evaluated' then null else (select auth.uid()) end,
      evaluated_at = case when p_result_status = 'not_evaluated' then null else now() end,
      updated_at = now()
  where id = v_item.id;

  return jsonb_build_object('ok', true, 'result_status', p_result_status);
end;
$$;

-- Vuelve a armar la parte personalizada de una evaluación en borrador (por ejemplo, si la
-- alumna marcó figuras después de que se inició). No borra lo ya calificado.
create or replace function public.staff_refresh_evaluation_personal_items(p_evaluation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eval public.technical_evaluations;
begin
  select * into v_eval from public.technical_evaluations where id = p_evaluation_id for update;
  if v_eval.id is null then
    raise exception 'evaluation_not_found';
  end if;

  if (select auth.uid()) is null then
    raise exception 'evaluation_access_denied';
  end if;

  perform private.evaluations_require_capability(v_eval.studio_id, 'evaluations.write');

  if v_eval.status <> 'draft' then
    raise exception 'evaluation_not_editable';
  end if;

  delete from public.technical_evaluation_personal_items
  where evaluation_id = v_eval.id
    and result_status = 'not_evaluated';

  return private.evaluation_pole_generate_personal_items(v_eval.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC · plantillas base de Pole
-- ---------------------------------------------------------------------------

-- Crea y activa una plantilla por nivel técnico activo de la disciplina que todavía no tenga
-- plantilla. Cada plantilla tiene dos apartados:
--   Figuras del nivel (Cumple / No cumple, 80%): hasta 8 figuras del programa base.
--   Técnica y seguridad (calificación directa, 20%).
-- Si dos niveles comparten nivel de catálogo (Intermedio / Intermedio avanzado), el programa
-- base se reparte en orden entre ellos. Nunca toca plantillas existentes.
create or replace function public.admin_seed_pole_evaluation_templates(p_discipline_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_discipline_name text;
  v_level record;
  v_template_id uuid;
  v_version_id uuid;
  v_block_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_figures integer;
begin
  select d.studio_id, d.name into v_studio_id, v_discipline_name
  from public.disciplines d
  where d.id = p_discipline_id and d.active = true
  for update;

  if v_studio_id is null then
    raise exception 'evaluation_discipline_not_found';
  end if;

  if (select auth.uid()) is null then
    raise exception 'evaluation_access_denied';
  end if;

  perform private.evaluations_require_capability(v_studio_id, 'evaluations.configure');

  if not exists (
    select 1 from public.pole_figure_profiles pfp
    where pfp.studio_id = v_studio_id and pfp.discipline_id = p_discipline_id
  ) then
    raise exception 'pole_catalog_missing';
  end if;

  for v_level in
    with levels as (
      select dtl.id, dtl.discipline_order, tld.title, tld.level_key,
             private.pole_catalog_level_for(v_studio_id, dtl.id) as catalog_level
      from public.discipline_technical_levels dtl
      join public.technical_level_definitions tld on tld.id = dtl.technical_level_id
      where dtl.studio_id = v_studio_id
        and dtl.discipline_id = p_discipline_id
        and dtl.active = true
        and tld.active = true
    )
    select l.*,
           row_number() over (partition by l.catalog_level order by l.discipline_order) as part,
           count(*) over (partition by l.catalog_level) as parts
    from levels l
    order by l.discipline_order
  loop
    if v_level.catalog_level is null then
      v_skipped := v_skipped || jsonb_build_object('level', v_level.title, 'reason', 'no_catalog_level');
      continue;
    end if;

    if exists (
      select 1 from public.evaluation_templates t
      where t.studio_id = v_studio_id
        and t.discipline_technical_level_id = v_level.id
        and t.archived_at is null
    ) then
      v_skipped := v_skipped || jsonb_build_object('level', v_level.title, 'reason', 'template_exists');
      continue;
    end if;

    insert into public.evaluation_templates
      (studio_id, discipline_id, discipline_technical_level_id, name, created_by)
    values
      (v_studio_id, p_discipline_id, v_level.id, 'Pole · ' || v_level.title, auth.uid())
    returning id into v_template_id;

    insert into public.evaluation_template_versions
      (studio_id, template_id, version_number, status, schema_version, pass_threshold,
       default_category_min, default_attempts_per_element, default_attempts_per_combo,
       evaluator_instructions, created_by)
    values
      (v_studio_id, v_template_id, 1, 'draft', 2, 80, 0, 3, 3,
       'Plantilla base generada desde el catálogo de figuras. Ajusta las figuras antes de usarla si lo necesitas.',
       auth.uid())
    returning id into v_version_id;

    insert into public.evaluation_template_criteria
      (studio_id, template_version_id, criterion_key, label, description, weight_percent,
       min_percent, sort_order, block_type, progression_required, evaluator_instructions)
    values
      (v_studio_id, v_version_id, 'figuras_nivel', 'Figuras del nivel',
       'Figuras del programa base de ' || v_level.title || '.', 80, null, 1, 'meets', false,
       'Cumple si la figura sale limpia y controlada en hasta 3 intentos.')
    returning id into v_block_id;

    -- Hasta 8 figuras: las que abren más figuras, sin repetir más de 3 del mismo tipo.
    with core as (
      select pfp.element_id, pfp.figure_type, pfp.sort_order,
             ntile(v_level.parts::integer) over (order by pfp.sort_order) as part
      from public.pole_figure_profiles pfp
      join public.technical_elements tel on tel.id = pfp.element_id and tel.active
      where pfp.studio_id = v_studio_id
        and pfp.discipline_id = p_discipline_id
        and pfp.catalog_level = v_level.catalog_level
        and pfp.in_core_program
    ),
    scored as (
      select c.*,
             (select count(*) from public.pole_figure_prerequisites p
              where p.required_element_id = c.element_id) as opens
      from core c
      where c.part = v_level.part
    ),
    typed as (
      select s.*,
             row_number() over (partition by s.figure_type order by s.opens desc, s.sort_order) as type_rank
      from scored s
    ),
    picked as (
      select t.element_id, t.sort_order
      from typed t
      where t.type_rank <= 3
      order by t.opens desc, t.sort_order
      limit 8
    )
    insert into public.evaluation_template_elements
      (studio_id, template_version_id, element_id, criterion_id, mandatory, scored, max_score,
       attempts_allowed, sort_order, item_kind, progression_required)
    select v_studio_id, v_version_id, p.element_id, v_block_id, false, false, 100, 3,
           row_number() over (order by p.sort_order), 'element', false
    from picked p;
    get diagnostics v_figures = row_count;

    if v_figures = 0 then
      raise exception 'pole_seed_level_without_figures';
    end if;

    insert into public.evaluation_template_criteria
      (studio_id, template_version_id, criterion_key, label, description, weight_percent,
       min_percent, sort_order, block_type, progression_required, evaluator_instructions)
    values
      (v_studio_id, v_version_id, 'tecnica_seguridad', 'Técnica y seguridad',
       'Control, líneas, agarres seguros y bajadas controladas.', 20, null, 2, 'direct_score',
       false, 'Califica de 0 a 100 cómo se vio el conjunto de la evaluación.');

    perform public.admin_activate_evaluation_template_version_v2(v_version_id);

    v_created := v_created || jsonb_build_object(
      'level', v_level.title,
      'template_id', v_template_id,
      'figures', v_figures
    );
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

revoke all on function private.pole_catalog_level_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.evaluations_next_level(uuid) from public, anon, authenticated;
revoke all on function private.evaluation_pole_generate_personal_items(uuid) from public, anon, authenticated;
revoke all on function private.technical_evaluations_after_insert_pole() from public, anon, authenticated;
revoke all on function private.technical_evaluations_after_publish_pole() from public, anon, authenticated;

revoke all on function public.staff_save_evaluation_personal_item(uuid, text, integer, text) from public, anon;
revoke all on function public.staff_refresh_evaluation_personal_items(uuid) from public, anon;
revoke all on function public.admin_seed_pole_evaluation_templates(uuid) from public, anon;

grant execute on function public.staff_save_evaluation_personal_item(uuid, text, integer, text) to authenticated;
grant execute on function public.staff_refresh_evaluation_personal_items(uuid) to authenticated;
grant execute on function public.admin_seed_pole_evaluation_templates(uuid) to authenticated;
