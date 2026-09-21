
-- EVALUACIONES-01 · Atomic criteria update for template editor.

create or replace function public.admin_update_evaluation_criteria(
  p_template_version_id uuid,
  p_criteria jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.evaluation_template_versions;
  v_item jsonb;
  v_criterion_id uuid;
  v_weight numeric;
  v_min numeric;
  v_count integer;
  v_used boolean;
begin
  select * into v_version
  from public.evaluation_template_versions
  where id = p_template_version_id;

  if v_version.id is null then
    raise exception 'evaluation_template_version_not_found';
  end if;

  perform private.evaluations_require_capability(v_version.studio_id, 'evaluations.configure');

  select exists (
    select 1
    from public.technical_evaluations e
    where e.template_version_id = p_template_version_id
  ) into v_used;

  if v_used then
    raise exception 'evaluation_template_version_in_use';
  end if;

  if v_version.status not in ('draft', 'active') then
    raise exception 'evaluation_template_version_not_editable';
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
    raise exception 'evaluation_criteria_payload_invalid';
  end if;

  select count(*) into v_count
  from public.evaluation_template_criteria c
  where c.template_version_id = p_template_version_id
    and c.studio_id = v_version.studio_id;

  if v_count <> jsonb_array_length(p_criteria) then
    raise exception 'evaluation_criteria_payload_incomplete';
  end if;

  for v_item in select value from jsonb_array_elements(p_criteria)
  loop
    v_criterion_id := nullif(v_item->>'id', '')::uuid;
    v_weight := nullif(v_item->>'weight_percent', '')::numeric;
    v_min := nullif(v_item->>'min_percent', '')::numeric;

    if v_criterion_id is null
       or v_weight is null
       or v_weight < 0
       or v_weight > 100
       or v_min is null
       or v_min < 0
       or v_min > 100 then
      raise exception 'evaluation_criterion_value_invalid';
    end if;

    update public.evaluation_template_criteria
    set
      weight_percent = v_weight,
      min_percent = v_min,
      updated_at = now()
    where id = v_criterion_id
      and template_version_id = p_template_version_id
      and studio_id = v_version.studio_id;

    if not found then
      raise exception 'evaluation_criterion_not_found';
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_update_evaluation_criteria(uuid,jsonb) from public, anon;
grant execute on function public.admin_update_evaluation_criteria(uuid,jsonb) to authenticated;
