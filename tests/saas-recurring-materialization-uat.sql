-- Sandbox only (hedouonyhynuvwbckdlg). All fixtures roll back.
begin;
do $test$
declare
  sid uuid;
  owner_id uuid;
  space_id uuid;
  v_template_id uuid;
  schedule_id uuid;
  original_discipline_id uuid;
  discipline_count integer;
  date_value date;
  activity_name text := 'S11 transaction ' || gen_random_uuid()::text;
  result uuid;
  denied boolean := false;
begin
  select s.id, m.user_id into strict sid, owner_id
  from public.studios s join public.studio_memberships m on m.studio_id=s.id
  where s.slug='studio-flow-s08-stripe-uat-20261011' and m.role='owner' and m.active;
  select id into space_id from public.spaces where studio_id=sid and active limit 1;
  select (now() at time zone timezone)::date+2 into date_value from public.studios where id=sid;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.headers',json_build_object('x-studio-id',sid)::text,true);
  result := public.admin_save_activity(
    p_studio_id=>sid,p_activity_id=>null,p_name=>activity_name,p_description=>'Transaction UAT',
    p_duration_minutes=>60,p_capacity=>1,p_color_hex=>'#FF0A8A',p_requires_resource=>false,
    p_drop_in_price_minor=>null,p_individual_purchase_notes=>null,p_default_instructor_id=>null,
    p_default_space_id=>space_id,p_starts_on=>date_value,p_ends_on=>date_value,
    p_schedules=>jsonb_build_array(jsonb_build_object('id',null,'weekday',extract(dow from date_value),'startTime','10:00')),
    p_minimum_reservations_enabled=>false,p_minimum_reservations=>2,p_minimum_review_minutes_before=>120,
    p_allow_minimum_reservation_override=>false);
  select id into strict v_template_id from public.class_templates where studio_id=sid and name=activity_name;
  assert exists(select 1 from public.class_templates t join public.disciplines d on d.id=t.discipline_id
    where t.id=v_template_id and d.studio_id=sid and d.active), 'New activity links to a package discipline';
  select id into strict schedule_id from public.recurring_schedules r where r.studio_id=sid and r.template_id=v_template_id;
  select discipline_id into original_discipline_id from public.class_templates where id=v_template_id;
  select count(*) into discipline_count from public.disciplines where studio_id=sid;
  result := public.admin_save_activity(
    p_studio_id=>sid,p_activity_id=>v_template_id,p_name=>activity_name || ' renamed',p_description=>'Transaction UAT',
    p_duration_minutes=>60,p_capacity=>1,p_color_hex=>'#FF0A8A',p_requires_resource=>false,
    p_drop_in_price_minor=>null,p_individual_purchase_notes=>null,p_default_instructor_id=>null,
    p_default_space_id=>space_id,p_starts_on=>date_value,p_ends_on=>date_value,
    p_schedules=>jsonb_build_array(jsonb_build_object('id',schedule_id,'weekday',extract(dow from date_value),'startTime','10:00')),
    p_minimum_reservations_enabled=>false,p_minimum_reservations=>2,p_minimum_review_minutes_before=>120,
    p_allow_minimum_reservation_override=>false);
  assert (select discipline_id=original_discipline_id from public.class_templates where id=v_template_id), 'Editing preserves the existing package discipline';
  assert (select count(*)=discipline_count from public.disciplines where studio_id=sid), 'Editing adds no duplicate discipline';
  assert (select count(*)=1 from public.class_sessions where recurring_schedule_id=schedule_id), 'One recurring session';
  assert (select bool_and(resource_uses_per_item=1 and not is_schedule_exception and not requires_resource)
    from public.class_sessions where recurring_schedule_id=schedule_id), 'Normal day defaults are valid';
  assert public.materialize_recurring_schedule(schedule_id,date_value)=0, 'Repeat materialization creates no duplicate';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.materialize_recurring_schedule(schedule_id,date_value);
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
    denied := true;
  end;
  assert denied, 'Nonmember cannot materialize sessions';
end;
$test$;
rollback;
select 'S11 recurring activity assertions passed; rolled back' as evidence;
