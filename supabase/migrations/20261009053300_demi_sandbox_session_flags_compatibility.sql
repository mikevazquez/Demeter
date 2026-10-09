CREATE OR REPLACE FUNCTION private.recursos01_apply_activity_defaults_before_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requires_resource boolean;
  v_resource_uses integer;
begin
  if tg_op = 'INSERT'
     or old.template_id is distinct from new.template_id
     or old.space_id is distinct from new.space_id then
    select ct.requires_resource, coalesce((to_jsonb(ct)->>'resource_uses_per_item')::integer, 1)
      into v_requires_resource, v_resource_uses
    from public.class_templates ct
    where ct.id = new.template_id
      and ct.studio_id = new.studio_id;

    if found then
      new.requires_resource := v_requires_resource;
      new.resource_uses_per_item := v_resource_uses;
      new := jsonb_populate_record(new, jsonb_build_object('resource_config_customized', false, 'resource_config_needs_review', false));
    end if;
  end if;

  return new;
end;
$function$

