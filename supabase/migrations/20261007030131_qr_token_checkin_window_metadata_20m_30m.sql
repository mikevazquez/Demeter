do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.student_reservation_checkin_token(uuid)'::regprocedure)
    into v_definition;
  if position('v_session.ends_at <= now()' in v_definition) = 0
     or position('v_session.starts_at - interval ''30 minutes''' in v_definition) = 0
     or position('''check_in_closes_at'', v_session.ends_at' in v_definition) = 0 then
    raise exception 'Unexpected production student_reservation_checkin_token definition';
  end if;
  v_definition := replace(v_definition,
    'v_session.ends_at <= now()',
    'v_session.starts_at + interval ''30 minutes'' <= now()');
  v_definition := replace(v_definition,
    'v_session.starts_at - interval ''30 minutes''',
    'v_session.starts_at - interval ''20 minutes''');
  v_definition := replace(v_definition,
    '''check_in_closes_at'', v_session.ends_at',
    '''check_in_closes_at'', v_session.starts_at + interval ''30 minutes''');
  execute v_definition;
end
$migration$;
