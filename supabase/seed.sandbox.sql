-- Studio Flow sandbox seed
-- FICTITIOUS DATA ONLY. Do not replace with production PII.
-- Safe to rerun: exits when the sentinel student already exists.

do $$
declare
  v_studio uuid;
  v_space uuid;
  v_pole uuid;
  v_exotic uuid;
  v_pole_template uuid;
  v_exotic_template uuid;
  v_product uuid;
  v_person_instructor uuid;
  v_instructor uuid;
  v_person_ana uuid;
  v_person_beto uuid;
  v_person_caro uuid;
  v_student_ana uuid;
  v_student_beto uuid;
  v_student_caro uuid;
  v_acq_ana uuid;
  v_acq_beto uuid;
  v_acq_caro uuid;
  v_session_one uuid;
  v_session_two uuid;
  v_reservation_ana uuid;
  v_reservation_beto uuid;
  v_start timestamptz;
begin
  select id into v_studio from public.studios where slug = 'demeter-fitness' limit 1;
  if v_studio is null then
    raise exception 'sandbox_seed_studio_missing';
  end if;

  if exists (
    select 1 from public.students
    where studio_id = v_studio and lower(email) = 'ana.sandbox@example.invalid'
  ) then
    return;
  end if;

  select id into v_space
  from public.spaces
  where studio_id = v_studio and active = true
  order by created_at asc
  limit 1;

  insert into public.disciplines(studio_id,name,active)
  values(v_studio,'Pole Fitness',true)
  on conflict (studio_id,name) do update set active = true
  returning id into v_pole;

  insert into public.disciplines(studio_id,name,active)
  values(v_studio,'Exotic Pole',true)
  on conflict (studio_id,name) do update set active = true
  returning id into v_exotic;

  insert into public.class_templates(
    studio_id,discipline_id,name,duration_minutes,capacity,active,credit_cost,drop_in_price_minor
  )
  values(v_studio,v_pole,'Sandbox · Pole Fitness',60,8,true,1,18000)
  returning id into v_pole_template;

  insert into public.class_templates(
    studio_id,discipline_id,name,duration_minutes,capacity,active,credit_cost,drop_in_price_minor
  )
  values(v_studio,v_exotic,'Sandbox · Exotic Pole',60,8,true,1,20000)
  returning id into v_exotic_template;

  insert into public.persons(studio_id,first_name,last_name)
  values(v_studio,'Alex','Coach Sandbox') returning id into v_person_instructor;
  insert into public.instructors(studio_id,person_id,status,bio)
  values(v_studio,v_person_instructor,'active','Perfil ficticio para pruebas de Coach') returning id into v_instructor;
  insert into public.instructor_disciplines(instructor_id,discipline_id) values(v_instructor,v_pole) on conflict do nothing;
  insert into public.instructor_disciplines(instructor_id,discipline_id) values(v_instructor,v_exotic) on conflict do nothing;

  insert into public.persons(studio_id,first_name,last_name)
  values(v_studio,'Ana','Sandbox') returning id into v_person_ana;
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_ana,v_studio,'phone','+99910000001',true);
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_ana,v_studio,'email','ana.sandbox@example.invalid',true);
  insert into public.students(studio_id,person_id,full_name,email,phone,active,lifecycle_status,profile_status)
  values(v_studio,v_person_ana,'Ana Sandbox','ana.sandbox@example.invalid','+99910000001',true,'active','complete')
  returning id into v_student_ana;

  insert into public.persons(studio_id,first_name,last_name)
  values(v_studio,'Beto','Sandbox') returning id into v_person_beto;
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_beto,v_studio,'phone','+99910000002',true);
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_beto,v_studio,'email','beto.sandbox@example.invalid',true);
  insert into public.students(studio_id,person_id,full_name,email,phone,active,lifecycle_status,profile_status)
  values(v_studio,v_person_beto,'Beto Sandbox','beto.sandbox@example.invalid','+99910000002',true,'active','complete')
  returning id into v_student_beto;

  insert into public.persons(studio_id,first_name,last_name)
  values(v_studio,'Caro','Sandbox') returning id into v_person_caro;
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_caro,v_studio,'phone','+99910000003',true);
  insert into public.person_contacts(person_id,studio_id,kind,value,is_primary)
  values(v_person_caro,v_studio,'email','caro.sandbox@example.invalid',true);
  insert into public.students(studio_id,person_id,full_name,email,phone,active,lifecycle_status,profile_status)
  values(v_studio,v_person_caro,'Caro Sandbox','caro.sandbox@example.invalid','+99910000003',true,'active','complete')
  returning id into v_student_caro;

  insert into public.product_templates(
    studio_id,name,description,product_type,package_term,price_minor,currency,credit_limit,validity_days,unlimited,active
  ) values(
    v_studio,'Sandbox · 8 clases','Producto ficticio para QA','package','monthly',60000,'MXN',8,30,false,true
  )
  on conflict (studio_id,name) do update set active = true, package_term = 'monthly'
  returning id into v_product;

  insert into public.product_template_disciplines(studio_id,product_template_id,discipline_id)
  values(v_studio,v_product,v_pole) on conflict do nothing;
  insert into public.product_template_disciplines(studio_id,product_template_id,discipline_id)
  values(v_studio,v_product,v_exotic) on conflict do nothing;

  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values(v_studio,v_student_ana,v_product,'active',current_date,current_date+30,8,false)
  returning id into v_acq_ana;
  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values(v_studio,v_student_beto,v_product,'active',current_date,current_date+30,8,false)
  returning id into v_acq_beto;
  insert into public.product_acquisitions(studio_id,student_id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited)
  values(v_studio,v_student_caro,v_product,'active',current_date,current_date+30,8,false)
  returning id into v_acq_caro;

  insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note)
  values(v_studio,v_acq_ana,'grant',8,'Sandbox seed');
  insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note)
  values(v_studio,v_acq_beto,'grant',8,'Sandbox seed');
  insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note)
  values(v_studio,v_acq_caro,'grant',8,'Sandbox seed');

  v_start := ((current_date + 1)::timestamp + time '18:00') at time zone 'America/Mexico_City';
  insert into public.class_sessions(studio_id,template_id,instructor_id,space_id,starts_at,ends_at,capacity,status,notes)
  values(v_studio,v_pole_template,v_instructor,v_space,v_start,v_start+interval '60 minutes',8,'scheduled','Sandbox F11 · roster con reservas')
  returning id into v_session_one;

  v_start := ((current_date + 2)::timestamp + time '19:00') at time zone 'America/Mexico_City';
  insert into public.class_sessions(studio_id,template_id,instructor_id,space_id,starts_at,ends_at,capacity,status,notes)
  values(v_studio,v_exotic_template,v_instructor,v_space,v_start,v_start+interval '60 minutes',8,'scheduled','Sandbox F11 · clase sin roster completo')
  returning id into v_session_two;

  insert into public.reservations(studio_id,session_id,student_id,acquisition_id,status,credits_held)
  values(v_studio,v_session_one,v_student_ana,v_acq_ana,'reserved',1)
  returning id into v_reservation_ana;
  insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,reservation_id,note)
  values(v_studio,v_acq_ana,'reserve',-1,v_reservation_ana,'Sandbox seed · reserva');

  insert into public.reservations(studio_id,session_id,student_id,acquisition_id,status,credits_held)
  values(v_studio,v_session_one,v_student_beto,v_acq_beto,'reserved',1)
  returning id into v_reservation_beto;
  insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,reservation_id,note)
  values(v_studio,v_acq_beto,'reserve',-1,v_reservation_beto,'Sandbox seed · reserva');
end $$;
