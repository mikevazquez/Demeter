create or replace function public.student_birthday_pass_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student public.students%rowtype;
  v_timezone text;
  v_today date;
  v_birth date;
  v_pass public.birthday_passes%rowtype;
  v_state text;
  v_is_birthday boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select s.* into v_student
  from public.students s
  where s.user_id = (select auth.uid())
    and private.is_current_student(s.id, s.studio_id)
  order by s.created_at asc
  limit 1;

  if not found then
    raise exception 'student_context_not_found';
  end if;

  select coalesce(st.timezone,'America/Mexico_City')
    into v_timezone
  from public.studios st
  where st.id = v_student.studio_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_birth := private.student_birth_date(v_student.id);

  if v_birth is null then
    return jsonb_build_object('eligible',false,'reason_code','birth_date_required');
  end if;

  v_is_birthday :=
    extract(month from v_birth)::integer = extract(month from v_today)::integer
    and (
      extract(day from v_birth)::integer = extract(day from v_today)::integer
      or (
        extract(month from v_birth)::integer = 2
        and extract(day from v_birth)::integer = 29
        and extract(month from v_today)::integer = 2
        and extract(day from v_today)::integer = 28
        and (
          extract(year from v_today)::integer % 4 <> 0
          or (
            extract(year from v_today)::integer % 100 = 0
            and extract(year from v_today)::integer % 400 <> 0
          )
        )
      )
    );

  if extract(month from v_birth)::integer <> extract(month from v_today)::integer then
    return jsonb_build_object(
      'eligible',false,
      'reason_code','outside_birthday_month',
      'birthday_month',extract(month from v_birth)::integer,
      'is_birthday',false
    );
  end if;

  v_pass := private.ensure_birthday_pass(v_student.id, v_today);
  v_state := case
    when v_pass.status = 'used' then 'used'
    when v_today > v_pass.expires_on then 'expired'
    else 'available'
  end;

  return jsonb_build_object(
    'eligible',true,
    'pass_id',v_pass.id,
    'state',v_state,
    'period_start',v_pass.period_start,
    'expires_on',v_pass.expires_on,
    'recipient_kind',v_pass.recipient_kind,
    'used_session_id',v_pass.used_session_id,
    'used_at',v_pass.used_at,
    'is_birthday',v_is_birthday
  );
end;
$function$;

revoke all on function public.student_birthday_pass_snapshot() from public, anon;
grant execute on function public.student_birthday_pass_snapshot() to authenticated;
