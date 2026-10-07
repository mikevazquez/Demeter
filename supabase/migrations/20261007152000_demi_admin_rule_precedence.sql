-- Demi can tighten its own behavior but cannot edit Studio Flow hard booking rules.
create or replace function public.admin_apply_demi_change_plan(
  p_studio_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $function$
declare
  v_request public.assistant_admin_change_requests%rowtype;
  v_action jsonb;
  v_type text;
  v_field text;
  v_count integer;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id,'settings.write') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into v_request
  from public.assistant_admin_change_requests
  where id=p_request_id and studio_id=p_studio_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','request_not_found'); end if;
  if v_request.status<>'proposed' then return jsonb_build_object('ok',false,'error','request_not_proposed'); end if;

  for v_action in select value from jsonb_array_elements(coalesce(v_request.plan->'actions','[]'::jsonb))
  loop
    v_type := coalesce(v_action->>'type','');

    if v_type='set_booking_behavior' then
      v_field := coalesce(v_action->>'field','');
      if v_field<>'prospect_require_payment_before_booking' then
        raise exception 'unsupported_booking_behavior_field';
      end if;
      update public.assistant_booking_behaviors
      set prospect_require_payment_before_booking=(v_action->>'value')::boolean,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id;
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'assistant_booking_behavior_not_found'; end if;

    elsif v_type='set_handoff_policy' then
      update public.assistant_handoff_policies
      set enabled=case when v_action ? 'enabled' then (v_action->>'enabled')::boolean else enabled end,
          blocking=case when v_action ? 'blocking' then (v_action->>'blocking')::boolean else blocking end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and reason_code=v_action->>'reason_code';
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'handoff_policy_not_found'; end if;

    elsif v_type='set_product' then
      update public.product_templates
      set price_minor=case when v_action ? 'price_minor' then (v_action->>'price_minor')::integer else price_minor end,
          active=case when v_action ? 'active' then (v_action->>'active')::boolean else active end,
          assistant_visible=case when v_action ? 'assistant_visible' then (v_action->>'assistant_visible')::boolean else assistant_visible end,
          online_purchasable=case when v_action ? 'online_purchasable' then (v_action->>'online_purchasable')::boolean else online_purchasable end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and name=v_action->>'product_name';
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'product_not_found_or_ambiguous'; end if;

    elsif v_type='set_class_price' then
      update public.class_templates
      set drop_in_price_minor=case when jsonb_typeof(v_action->'price_minor')='null' then null else (v_action->>'price_minor')::integer end,
          updated_at=clock_timestamp()
      where studio_id=p_studio_id and name=v_action->>'activity_name' and active=true;
      get diagnostics v_count = row_count;
      if v_count<>1 then raise exception 'activity_not_found_or_ambiguous'; end if;

    elsif v_type='upsert_rule' then
      insert into public.assistant_admin_rules(
        studio_id,rule_key,category,instruction,enabled,source_request_id,created_by,updated_by
      ) values(
        p_studio_id,
        v_action->>'rule_key',
        v_action->>'category',
        v_action->>'instruction',
        coalesce((v_action->>'enabled')::boolean,true),
        p_request_id,
        auth.uid(),
        auth.uid()
      )
      on conflict(studio_id,rule_key) do update set
        category=excluded.category,
        instruction=excluded.instruction,
        enabled=excluded.enabled,
        source_request_id=excluded.source_request_id,
        updated_by=auth.uid(),
        updated_at=clock_timestamp();

    else
      raise exception 'unsupported_admin_action';
    end if;
  end loop;

  update public.assistant_admin_change_requests
  set status='applied',applied_by=auth.uid(),applied_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=null
  where id=p_request_id and studio_id=p_studio_id;

  return jsonb_build_object('ok',true,'status','applied');
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$;

revoke all on function public.admin_apply_demi_change_plan(uuid,uuid) from public,anon;
grant execute on function public.admin_apply_demi_change_plan(uuid,uuid) to authenticated;
