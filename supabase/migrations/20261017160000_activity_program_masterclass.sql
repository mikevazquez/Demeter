DO $migration$
DECLARE v_constraint text; v_def text;
BEGIN
 SELECT conname INTO v_constraint FROM pg_constraint
 WHERE conrelid='public.activity_programs'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%kind%';
 IF v_constraint IS NOT NULL THEN
  EXECUTE format('ALTER TABLE public.activity_programs DROP CONSTRAINT %I',v_constraint);
 END IF;
 ALTER TABLE public.activity_programs ADD CONSTRAINT activity_programs_kind_check
 CHECK (kind IN ('workshop','event','masterclass'));
 SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_create_activity_program'
 AND pg_get_function_identity_arguments(p.oid)='p_studio_id uuid, p_program jsonb';
 IF v_def IS NULL THEN RAISE EXCEPTION 'admin_create_activity_program signature not found'; END IF;
 IF position('not in (''workshop'',''event'')' in v_def)=0 THEN
  RAISE EXCEPTION 'unexpected program creation validation';
 END IF;
 EXECUTE replace(v_def,'not in (''workshop'',''event'')','not in (''workshop'',''event'',''masterclass'')');
END
$migration$;