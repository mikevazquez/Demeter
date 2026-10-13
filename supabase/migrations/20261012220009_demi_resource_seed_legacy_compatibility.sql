-- Some deployments have the template-aware trigger but no template resource table.
-- Preserve template settings when present; otherwise use the existing space defaults.
do $migration$
declare original text; changed text;
begin
 select pg_get_functiondef('private.recursos01_sync_session_resources()'::regprocedure) into original;
 if position('v_has_template_settings := exists (' in original)=0 then
  raise exception 'unexpected_resource_seed_definition';
 end if;
 changed := replace(original,'v_has_template_settings := exists (',
  'if to_regclass(''public.class_template_resources'') is not null then v_has_template_settings := exists (');
 changed := replace(changed,E'  );\n\n  if v_has_template_settings then',
  E'  );\n end if;\n\n  if v_has_template_settings then');
 if changed=original or position(E'end if;\n\n  if v_has_template_settings then' in changed)=0 then raise exception 'resource_seed_compatibility_patch_failed'; end if;
 execute changed;
end; $migration$;
