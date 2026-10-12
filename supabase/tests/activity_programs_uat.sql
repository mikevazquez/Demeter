begin;
create temporary table program_uat_results(case_id text primary key,result text);
do $$
declare
 v_uid uuid; v_studio uuid; v_d1 uuid; v_d2 uuid; v_person uuid;
 v_a uuid; v_b uuid; v_c uuid; v_program uuid; v_one uuid; v_same uuid;
 v_req uuid:=gen_random_uuid(); v_json jsonb; v_sale jsonb; v_replay jsonb;
 v_first uuid; v_count integer; v_before integer; v_product uuid; v_nowdate date;
begin
 select user_id into v_uid from public.studio_memberships where active and role::text='owner' limit 1;
 if v_uid is null then raise exception 'uat_owner_missing'; end if;
 perform set_config('request.jwt.claim.sub',v_uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
 insert into public.studios(name,slug,timezone,currency) values('Talleres UAT aislado','talleres-uat-'||gen_random_uuid(),'America/Mexico_City','MXN') returning id into v_studio;
 insert into public.studio_plan_assignments(studio_id,plan_id,status) select v_studio,p.id,'active' from public.saas_plans p where p.active order by (select count(*) from public.saas_plan_modules pm where pm.plan_id=p.id and pm.enabled) desc limit 1;
 insert into public.studio_memberships(studio_id,user_id,role,active) values(v_studio,v_uid,'owner',true);
 insert into public.disciplines(studio_id,name) values(v_studio,'Aro UAT') returning id into v_d1;
 insert into public.disciplines(studio_id,name) values(v_studio,'Telas UAT') returning id into v_d2;
 insert into public.persons(studio_id,first_name) values(v_studio,'Alumna A UAT') returning id into v_person;
 insert into public.students(studio_id,person_id,full_name) values(v_studio,v_person,'Alumna A UAT') returning id into v_a;
 insert into public.persons(studio_id,first_name) values(v_studio,'Alumna B UAT') returning id into v_person;
 insert into public.students(studio_id,person_id,full_name) values(v_studio,v_person,'Alumna B UAT') returning id into v_b;
 insert into public.persons(studio_id,first_name) values(v_studio,'Alumna C UAT') returning id into v_person;
 insert into public.students(studio_id,person_id,full_name) values(v_studio,v_person,'Alumna C UAT') returning id into v_c;
 v_nowdate:=(now() at time zone 'America/Mexico_City')::date+7;
 select jsonb_build_object('name','Cinco domingos UAT','kind','workshop','description','Prueba ficticia','fullPriceMinor',90000,'allowSingle',true,'dates',jsonb_agg(jsonb_build_object('date',v_nowdate+7*i,'time','10:00','disciplineId',case when i%2=0 then v_d1 else v_d2 end,'durationMinutes',60,'capacity',2,'priceMinor',25000))) into v_json from generate_series(0,4) i;
 v_program:=public.admin_create_activity_program(v_studio,v_json);
 select count(*) into v_count from public.activity_program_sessions where program_id=v_program;
 if v_count<>5 then raise exception 'expected_5_sessions:%',v_count; end if;
 insert into program_uat_results values('T03','PASS: cinco fechas, disciplinas alternas, cinco sesiones reales');
 v_same:=public.admin_create_activity_program(v_studio,jsonb_set(jsonb_set(v_json,'{name}','"Misma disciplina UAT"'),'{dates}',(select jsonb_agg(value||jsonb_build_object('disciplineId',v_d1,'time','12:00')) from jsonb_array_elements(v_json->'dates'))));
 if (select count(distinct ct.discipline_id) from public.class_templates ct where ct.program_id=v_same)<>1 then raise exception 'same_discipline_failed'; end if;
 insert into program_uat_results values('T02','PASS: cinco fechas, misma disciplina');
 v_one:=public.admin_create_activity_program(v_studio,jsonb_build_object('name','Evento 3 horas UAT','kind','event','fullPriceMinor',50000,'allowSingle',true,'dates',jsonb_build_array(jsonb_build_object('date',v_nowdate,'time','15:00','disciplineId',v_d1,'durationMinutes',180,'capacity',5))));
 if (select allow_single from public.activity_programs where id=v_one) or exists(select 1 from public.activity_program_sessions where program_id=v_one and single_product_id is not null) then raise exception 'one_day_single_enabled'; end if;
 if not exists(select 1 from public.activity_program_sessions ps join public.class_sessions cs on cs.id=ps.session_id where ps.program_id=v_one and cs.ends_at-cs.starts_at=interval '3 hours') then raise exception 'duration_failed'; end if;
 insert into program_uat_results values('T01','PASS: evento de un día, tres horas, solo precio completo');
 select session_id into v_first from public.activity_program_sessions where program_id=v_program and position=1;
 v_sale:=public.admin_enroll_activity_program(v_program,v_a,null,'cash',null,v_req);
 select count(*) into v_count from public.reservations r join public.activity_program_sessions ps on ps.session_id=r.session_id where ps.program_id=v_program and r.student_id=v_a and r.status='reserved';
 if v_count<>5 then raise exception 'full_booking_failed:%',v_count; end if;
 if (v_sale->>'paid_minor')::integer<>90000 then raise exception 'full_price_failed'; end if;
 insert into program_uat_results values('T04','PASS: completo registra pago exacto y cinco reservas');
 v_replay:=public.admin_enroll_activity_program(v_program,v_a,null,'cash',null,v_req);
 if v_replay->>'sale_id' is distinct from v_sale->>'sale_id' then raise exception 'duplicate_sale'; end if;
 insert into program_uat_results values('T10','PASS: reintento de inscripción devuelve la misma venta');
 v_sale:=public.admin_enroll_activity_program(v_program,v_b,v_first,'transfer','UAT ficticia',gen_random_uuid());
 select count(*) into v_count from public.reservations r join public.activity_program_sessions ps on ps.session_id=r.session_id where ps.program_id=v_program and r.student_id=v_b;
 if v_count<>1 or (v_sale->>'paid_minor')::integer<>25000 then raise exception 'single_booking_failed'; end if;
 insert into program_uat_results values('T05','PASS: compra suelta paga una fecha y reserva un lugar');
 select count(*) into v_before from public.sales where studio_id=v_studio;
 begin
  perform public.admin_enroll_activity_program(v_program,v_c,null,'cash',null,gen_random_uuid());
  raise exception 'expected_sold_out';
 exception when others then
  if sqlerrm not like '%program_session_unavailable%' then raise; end if;
 end;
 if (select count(*) from public.sales where studio_id=v_studio)<>v_before or exists(select 1 from public.reservations where student_id=v_c) then raise exception 'partial_sale_or_booking'; end if;
 insert into program_uat_results values('T06','PASS: cupo compartido, una fecha llena revierte toda la compra');
 begin
  perform public.admin_create_activity_program(v_studio,jsonb_set(v_json,'{dates}',jsonb_build_array(v_json->'dates'->0,v_json->'dates'->0)));
  raise exception 'expected_duplicate_date';
 exception when others then
  if sqlerrm not like '%duplicate_program_date%' then raise; end if;
 end;
 insert into program_uat_results values('T07','PASS: fecha duplicada rechazada sin programa parcial');
 select full_product_id into v_product from public.activity_programs where id=v_one;
 begin
  perform public.create_manual_sale(v_c,array[v_product],50000,'cash',null,null,v_nowdate);
  raise exception 'expected_generic_sale_blocked';
 exception when others then
  if sqlerrm not like '%use_program_enrollment%' then raise; end if;
 end;
 insert into program_uat_results values('T08','PASS: venta genérica no puede prometer cupo sin reservar');
 insert into public.product_templates(studio_id,name,product_type,price_minor,currency,credit_limit,validity_days,unlimited) values(v_studio,'Paquete normal UAT','package',10000,'MXN',8,30,false) returning id into v_product;
 if private.program_product_allows_session(v_product,v_first) then raise exception 'regular_package_allowed'; end if;
 insert into program_uat_results values('T09','PASS: paquete regular no permite acceso a taller');

 -- Single-day credit never opens another day of the same program.
 if (public.booking_eligibility((select session_id from public.activity_program_sessions where program_id=v_program and position=2),v_b)->>'eligible')::boolean then raise exception 'single_credit_opened_other_day'; end if;
 insert into program_uat_results values('T14','PASS: compra suelta no permite otra fecha del mismo taller');
 -- The normal-class branch keeps its existing behavior and ledger semantics.
 insert into public.product_template_disciplines(studio_id,product_template_id,discipline_id) values(v_studio,v_product,v_d1);
 perform public.create_manual_sale(v_c,array[v_product],10000,'cash',null,null,v_nowdate);
 insert into public.class_templates(studio_id,discipline_id,name,duration_minutes,capacity) values(v_studio,v_d1,'Clase normal UAT',60,5) returning id into v_person;
 insert into public.class_sessions(studio_id,template_id,starts_at,ends_at,capacity) values(v_studio,v_person,((v_nowdate+3)::text||' 10:00')::timestamp at time zone 'America/Mexico_City',((v_nowdate+3)::text||' 11:00')::timestamp at time zone 'America/Mexico_City',5) returning id into v_one;
 if not (public.book_student(v_one,v_c)->>'eligible')::boolean then raise exception 'normal_booking_regression'; end if;
 if (select sum(cl.quantity) from public.credit_ledger cl join public.product_acquisitions pa on pa.id=cl.acquisition_id where pa.student_id=v_c and pa.product_template_id=v_product)<>7 then raise exception 'normal_credit_regression'; end if;
 insert into program_uat_results values('T13','PASS: clase normal conserva reserva y créditos 8 a 7');
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.admin_create_activity_program(v_studio,v_json);
  raise exception 'expected_tenant_guard';
 exception when others then
  if sqlerrm not like '%forbidden%' then raise; end if;
 end;
 insert into program_uat_results values('T12','PASS: usuario sin membresía del estudio no puede crear programas');
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform public.admin_create_activity_program(v_studio,v_json);
  raise exception 'expected_auth_guard';
 exception when others then
  if sqlerrm not like '%unauthenticated%' then raise; end if;
 end;
 insert into program_uat_results values('T11','PASS: RPC sin autenticación rechazada');
end $$;
select * from program_uat_results order by case_id;
rollback;
