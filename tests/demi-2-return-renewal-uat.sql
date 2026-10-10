-- Real roles and native renewal; each synthetic variant is rolled back.
begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
set local request.jwt.claim.role='service_role';
do $$
declare source uuid:='9fe23cfa-fb47-4670-afeb-ed4a56433772'; owner uuid; run jsonb; s uuid; st uuid; c uuid; a uuid; e uuid; enrollment uuid; r jsonb; intent uuid; receipt uuid; today date; variant text; before_packages jsonb; before_credits jsonb; results jsonb:='[]'; n integer;
begin
 select user_id into owner from public.studio_memberships where studio_id=source and role='owner' and active limit 1;
 foreach variant in array array['valid','expired','exhausted'] loop
  execute 'set local role service_role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);perform set_config('request.jwt.claim.role','service_role',true);
  run:=public.service_create_demi_uat_run(source,owner,'M16-'||variant);s:=(run->>'studio_id')::uuid;
  st:=(run#>>'{fixtures,people,former_active_package,student_id}')::uuid;
  select (clock_timestamp() at time zone timezone)::date into today from public.studios where id=s;
  select id into a from public.product_acquisitions where studio_id=s and student_id=st;
  if variant='expired' then update public.product_acquisitions set expires_on=today-1 where id=a;
  elsif variant='exhausted' then insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note) values(s,a,'adjustment',-8,'Synthetic exhausted-package fixture; no real credits'); end if;
  select jsonb_agg(to_jsonb(p) order by p.id) into before_packages from public.product_acquisitions p where studio_id=s and student_id=st;
  select jsonb_agg(to_jsonb(l) order by l.id) into before_credits from public.credit_ledger l where acquisition_id=a;
  r:=public.service_booking_eligibility(s,(run#>>'{fixtures,sessions,available}')::uuid,st);
  if coalesce((r->>'eligible')::boolean,false) then raise exception 'expired_enrollment_accepted_%:%',variant,r; end if;
  c:=gen_random_uuid(); insert into public.assistant_conversations(id,studio_id,student_id,channel) values(c,s,st,'whatsapp');
  n:=public.service_seed_due_demi_followups(s,clock_timestamp()+interval '7 days');
  select id into enrollment from public.student_enrollments where studio_id=s and student_id=st and expires_on=today-1;
  if (select count(*) from public.demi_followups where studio_id=s and source_ref=enrollment::text and kind='enrollment' and state='pending')<>3 then raise exception 'enrollment_recovery_schedule_%',variant; end if;
  r:=public.service_prepare_demi_enrollment_payment(s,c,st,'bank_transfer');intent:=(r->>'intent_id')::uuid;
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'renewal_prepare_%:%',variant,r; end if;
  e:=gen_random_uuid();insert into public.assistant_whatsapp_events(id,studio_id,provider,provider_event_id,phone_number_id,contact_wa_id,message_type,media_id,payload_fingerprint,assistant_conversation_id) values(e,s,'meta_whatsapp','M16-'||e,'uat','529990000011','image','uat','M16-'||variant,c);
  r:=public.service_record_demi_enrollment_receipt(s,c,intent,e,'M16-'||e,s||'/enrollment/'||intent||'/proof',repeat(md5(variant),2),20000,'MXN',0.99);receipt:=(r->>'receipt_id')::uuid;
  if not coalesce((r->>'ok')::boolean,false) or exists(select 1 from public.student_enrollments where studio_id=s and student_id=st and status='active' and expires_on>today) then raise exception 'premature_renewal_%:%',variant,r; end if;
  execute 'set local role authenticated';perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner)::text,true);perform set_config('request.jwt.claim.role','authenticated',true);perform set_config('request.jwt.claim.sub',owner::text,true);
  r:=public.admin_review_demi_enrollment_receipt(s,receipt,'approved','UAT ficticio: validación manual sin ingreso real; rollback');
  if not coalesce((r->>'ok')::boolean,false) or not exists(select 1 from public.student_enrollments where studio_id=s and student_id=st and status='active' and expires_on>today) then raise exception 'renewal_not_active_%:%',variant,r; end if;
  if (select jsonb_agg(to_jsonb(p) order by p.id) from public.product_acquisitions p where studio_id=s and student_id=st) is distinct from before_packages or (select jsonb_agg(to_jsonb(l) order by l.id) from public.credit_ledger l where acquisition_id=a) is distinct from before_credits then raise exception 'renewal_changed_package_%',variant; end if;
  execute 'set local role service_role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);perform set_config('request.jwt.claim.role','service_role',true);
  if exists(select 1 from public.demi_followups where studio_id=s and source_ref=enrollment::text and kind='enrollment' and state in ('pending','processing')) or (select count(*) from public.demi_followups where studio_id=s and source_ref=enrollment::text and kind='enrollment' and reason_code='enrollment_renewed')<>3 then raise exception 'renewal_did_not_stop_immediately_%',variant; end if;
  r:=public.service_booking_eligibility(s,(run#>>'{fixtures,sessions,available}')::uuid,st);
  if variant='valid' and not coalesce((r->>'eligible')::boolean,false) then raise exception 'valid_credits_not_restored:%',r; end if;
  if variant<>'valid' and coalesce((r->>'eligible')::boolean,false) then raise exception 'nonexistent_credits_granted_%:%',variant,r; end if;
  r:=public.assistant_trial_booking_preview(s,(run#>>'{fixtures,sessions,available}')::uuid,st,null);
  -- Regular students must not be prepared as a first trial by Demi after renewal.
  if r->>'reason_code'<>'trial_identity_required' or (select student_type::text from public.students where id=st)<>'regular' or exists(select 1 from public.reservations where studio_id=s and student_id=st) then raise exception 'new_trial_or_booking_%',variant; end if;
  results:=results||jsonb_build_array(jsonb_build_object('case','M16','variant',variant,'passed',true,'manual_renewal',true,'packages_and_credit_ledger_unchanged',true,'recovery_cancelled_immediately',true,'no_new_trial',true));
 end loop;
 perform set_config('uat.return_renewal_results',results::text,true);
end $$;
select current_setting('uat.return_renewal_results')::jsonb results;
rollback;
