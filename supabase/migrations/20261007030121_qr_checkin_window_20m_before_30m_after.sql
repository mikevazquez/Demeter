do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.check_in_reservation(text)'::regprocedure)
    into v_definition;
  if position('v_checked_in_at timestamptz;' in v_definition) = 0
     or position('v_session.starts_at - interval ''30 minutes''' in v_definition) = 0
     or position('now() >= v_session.ends_at' in v_definition) = 0 then
    raise exception 'Unexpected production check_in_reservation definition';
  end if;
  v_definition := replace(v_definition,
    'v_checked_in_at timestamptz;',
    'v_checked_in_at timestamptz;' || E'\n  v_checkin_now timestamptz;');
  v_definition := replace(v_definition,
    'if now() < v_session.starts_at - interval ''30 minutes'' then',
    'v_checkin_now := clock_timestamp();' || E'\n\n  if v_checkin_now < v_session.starts_at - interval ''20 minutes'' then');
  v_definition := replace(v_definition,
    'now() >= v_session.ends_at',
    'v_checkin_now >= v_session.starts_at + interval ''30 minutes''');
  v_definition := replace(v_definition,
    'v_checked_in_at := clock_timestamp();',
    'v_checked_in_at := v_checkin_now;');
  execute v_definition;
end
$migration$;
