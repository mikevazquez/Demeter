do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.check_in_reservation(text)'::regprocedure) into v_definition;
  if position('''available_at'', v_session.starts_at - interval ''30 minutes''' in v_definition) = 0 then
    raise exception 'Unexpected production available_at expression';
  end if;
  v_definition := replace(v_definition,
    '''available_at'', v_session.starts_at - interval ''30 minutes''',
    '''available_at'', v_session.starts_at - interval ''20 minutes''');
  execute v_definition;
end
$migration$;
