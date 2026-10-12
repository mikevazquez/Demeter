-- The UAT runner copies Demi and Polina handoff policies explicitly.
-- Remove the older generic copy that re-inserted the same rows and aborted
-- scenario creation on the assistant_key/reason_code unique constraint.
do $migration$
declare
  original text;
  changed text;
  duplicate_seed text := 'insert into public.assistant_handoff_policies select (jsonb_populate_record(null::public.assistant_handoff_policies,to_jsonb(x)||jsonb_build_object(''id'',gen_random_uuid(),''studio_id'',s))).* from public.assistant_handoff_policies x where studio_id=p_source_studio;';
begin
  select pg_get_functiondef('public.service_create_demi_uat_run(uuid,uuid,text)'::regprocedure)
  into original;

  if original is null or position(duplicate_seed in original)=0 then
    raise exception 'unexpected_demi_uat_handoff_seed';
  end if;

  changed := replace(original, duplicate_seed, '');
  if changed=original or position(duplicate_seed in changed)>0 then
    raise exception 'demi_uat_handoff_seed_patch_failed';
  end if;

  execute changed;
end;
$migration$;
