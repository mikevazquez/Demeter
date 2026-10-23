-- Open attendance QR check-in 3 hours 30 minutes before class starts.
-- Keep the existing close at 30 minutes after class starts and all other behavior.
do $migration$
declare
  v_checkin_definition text;
  v_token_definition text;
  v_old_opening constant text := 'v_session.starts_at - interval ''20 minutes''';
  v_new_opening constant text := 'v_session.starts_at - interval ''210 minutes''';
begin
  select pg_get_functiondef('public.check_in_reservation(text)'::regprocedure)
    into v_checkin_definition;
  select pg_get_functiondef('public.student_reservation_checkin_token(uuid)'::regprocedure)
    into v_token_definition;

  -- Validate both definitions before replacing either function.
  if position('v_checkin_now < ' || v_old_opening in v_checkin_definition) = 0
     or position('''available_at'', ' || v_old_opening in v_checkin_definition) = 0
     or position('v_checkin_now >= v_session.starts_at + interval ''30 minutes''' in v_checkin_definition) = 0 then
    raise exception 'Unexpected check_in_reservation check-in window definition';
  end if;
  if position('''check_in_opens_at'', ' || v_old_opening in v_token_definition) = 0
     or position('''check_in_closes_at'', v_session.starts_at + interval ''30 minutes''' in v_token_definition) = 0 then
    raise exception 'Unexpected student_reservation_checkin_token check-in window definition';
  end if;

  execute replace(v_checkin_definition, v_old_opening, v_new_opening);
  execute replace(v_token_definition, v_old_opening, v_new_opening);
end
$migration$;
