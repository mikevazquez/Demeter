-- EVALUACIONES v2 · require an explicit minimum when a scored block/item is a progression gate.

create or replace function public.admin_activate_evaluation_template_version_v2(
  p_template_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.evaluation_template_versions;
  v_template public.evaluation_templates;
  v_total numeric;
  v_block public.evaluation_template_criteria;
  v_item_count integer;
  v_item_weight numeric;
  v_weighted_count integer;
begin
  select * into v_version
  from public.evaluation_template_versions
  where id = p_template_version_id;

  if v_version.id is null then
    raise exception 'evaluation_template_version_not_found';
  end if;

  select * into v_template
  from public.evaluation_templates
  where id = v_version.template_id;

  perform private.evaluations_require_capability(v_version.studio_id, 'evaluations.configure');

  if v_version.schema_version <> 2 then
    raise exception 'evaluation_template_not_v2';
  end if;

  select coalesce(sum(c.weight_percent), 0)
    into v_total
  from public.evaluation_template_criteria c
  where c.template_version_id = v_version.id;

  if abs(v_total - 100) > 0.01 then
    raise exception 'evaluation_v2_block_weight_total';
  end if;

  if not exists (
    select 1
    from public.evaluation_template_criteria c
    where c.template_version_id = v_version.id
  ) then
    raise exception 'evaluation_v2_blocks_required';
  end if;

  for v_block in
    select *
    from public.evaluation_template_criteria
    where template_version_id = v_version.id
  loop
    if v_block.progression_required and v_block.min_percent is null then
      raise exception 'evaluation_v2_progression_min_required';
    end if;

    if v_block.block_type <> 'direct_score' then
      select count(*),
             count(*) filter (where te.item_weight_percent is not null),
             coalesce(sum(te.item_weight_percent), 0)
        into v_item_count, v_weighted_count, v_item_weight
      from public.evaluation_template_elements te
      where te.template_version_id = v_version.id
        and te.criterion_id = v_block.id;

      if v_item_count = 0 then
        raise exception 'evaluation_v2_block_items_required';
      end if;

      if v_block.block_type = 'weighted_criteria' then
        if v_weighted_count <> v_item_count or abs(v_item_weight - 100) > 0.01 then
          raise exception 'evaluation_v2_item_weight_total';
        end if;
      elsif v_weighted_count > 0
        and (v_weighted_count <> v_item_count or abs(v_item_weight - 100) > 0.01) then
        raise exception 'evaluation_v2_item_weight_total';
      end if;

      if exists (
        select 1
        from public.evaluation_template_elements te
        where te.template_version_id = v_version.id
          and te.criterion_id = v_block.id
          and te.progression_required
          and te.scored
          and te.min_score is null
      ) then
        raise exception 'evaluation_v2_progression_min_required';
      end if;
    end if;
  end loop;

  update public.evaluation_template_versions
  set status = 'archived',
      archived_at = now(),
      updated_at = now()
  where template_id = v_version.template_id
    and id <> v_version.id
    and status = 'active';

  update public.evaluation_template_versions
  set status = 'active',
      activated_at = coalesce(activated_at, now()),
      archived_at = null,
      updated_at = now()
  where id = v_version.id;
end;
$$;

revoke all on function public.admin_activate_evaluation_template_version_v2(uuid) from public, anon;
grant execute on function public.admin_activate_evaluation_template_version_v2(uuid) to authenticated;
