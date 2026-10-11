-- The original $150 receipt stays on the first-class sale. The new enrollment
-- receives a commercial credit tied to that receipt, not a second cash receipt.
create table public.trial_enrollment_credits (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  student_id uuid not null references public.students(id),
  source_payment_id uuid not null unique references public.payments(id),
  source_sale_id uuid not null unique references public.sales(id),
  reservation_id uuid not null unique references public.reservations(id),
  target_sale_id uuid not null unique references public.sales(id),
  target_sale_line_id uuid not null unique references public.sale_lines(id),
  amount_minor integer not null check (amount_minor=15000),
  effective_on date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.trial_enrollment_credits enable row level security;
create policy trial_enrollment_credits_read on public.trial_enrollment_credits
  for select to authenticated using (private.has_capability(studio_id,'sales.read') or private.has_capability(studio_id,'sales.write'));
grant select on public.trial_enrollment_credits to authenticated;
revoke insert,update,delete on public.trial_enrollment_credits from authenticated,anon;

create function public.get_trial_enrollment_credit_options(target_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare st public.students%rowtype; today date; result jsonb;
begin
 select * into st from public.students where id=target_student_id;
 if not found or (select auth.uid()) is null or not private.has_capability(st.studio_id,'sales.write') then raise exception 'forbidden'; end if;
 select (clock_timestamp() at time zone coalesce(timezone,'America/Mexico_City'))::date into today from public.studios where id=st.studio_id;
 if not exists(select 1 from public.assistant_admin_rules where studio_id=st.studio_id and rule_key='trial_payment_towards_enrollment' and enabled) then return '[]'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'reservation_id',r.id,'source_sale_id',sa.id,'amount_minor',15000,'currency',sa.currency,'class_on',today) order by p.created_at),'[]') into result
 from public.assistant_transfer_purchase_intents i
 join public.sales sa on sa.id=i.sale_id and sa.studio_id=st.studio_id and sa.student_id=st.id and sa.status='confirmed' and sa.total_minor=15000 and sa.currency='MXN'
 join public.payments p on p.sale_id=sa.id and p.studio_id=st.studio_id and p.kind='payment' and p.amount_minor=15000
 join public.reservations r on r.id=i.reservation_id and r.studio_id=st.studio_id and r.student_id=st.id and r.status in ('reserved','attended')
 join public.class_sessions cs on cs.id=r.session_id and cs.studio_id=st.studio_id
 join public.product_acquisitions pa on pa.id=i.acquisition_id and pa.studio_id=st.studio_id and pa.refunded_at is null
 where i.studio_id=st.studio_id and i.student_id=st.id and i.intent_kind='trial_class' and i.status='validated'
 and (cs.starts_at at time zone (select coalesce(timezone,'America/Mexico_City') from public.studios where id=st.studio_id))::date=today
 and not exists(select 1 from public.payments p2 where p2.sale_id=sa.id and p2.id<>p.id)
 and not exists(select 1 from public.trial_enrollment_credits tc where tc.source_sale_id=sa.id or tc.reservation_id=r.id)
 and not exists(select 1 from public.reservations old join public.class_sessions oc on oc.id=old.session_id where old.studio_id=st.studio_id and old.student_id=st.id and old.status='attended' and oc.starts_at<cs.starts_at)
 and not exists(select 1 from public.student_enrollments se where se.studio_id=st.studio_id and se.student_id=st.id and se.status='active' and se.starts_on<=today and (se.expires_on is null or se.expires_on>=today));
 return result;
end; $$;
revoke all on function public.get_trial_enrollment_credit_options(uuid) from public,anon;
grant execute on function public.get_trial_enrollment_credit_options(uuid) to authenticated;

create function public.create_package_with_trial_enrollment_credit(
 target_student_id uuid,target_package_product_id uuid,target_enrollment_product_id uuid,
 target_source_payment_id uuid,target_idempotency_key uuid,package_start_mode text,package_starts_on date,
 initial_payment_minor integer,payment_method text,payment_effective_on date,payment_reference text,payment_notes text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare st public.students%rowtype; source public.payments%rowtype; pkg public.product_templates%rowtype; enroll public.product_templates%rowtype;
 today date; option jsonb; core jsonb; sale uuid; line uuid; total integer; prior public.trial_enrollment_credits%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
 select * into st from public.students where id=target_student_id for update;
 if not found or not private.has_capability(st.studio_id,'sales.write') then raise exception 'forbidden'; end if;
 if target_idempotency_key is null then raise exception 'idempotency_key_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_idempotency_key::text,0));
 select tc.* into prior from public.trial_enrollment_credits tc join public.sales sa on sa.id=tc.target_sale_id
 where tc.studio_id=st.studio_id and sa.idempotency_key=target_idempotency_key;
 if found then
   if prior.student_id<>st.id or prior.source_payment_id<>target_source_payment_id then raise exception 'trial_credit_replay_mismatch'; end if;
   return jsonb_build_object('ok',true,'replayed',true,'sale_id',prior.target_sale_id,'trial_credit_minor',15000);
 end if;
 if exists(select 1 from public.sales where studio_id=st.studio_id and idempotency_key=target_idempotency_key) then raise exception 'trial_credit_replay_mismatch'; end if;
 select * into source from public.payments where id=target_source_payment_id and studio_id=st.studio_id for update;
 if not found then raise exception 'trial_credit_unavailable'; end if;
 perform 1 from public.sales where id=source.sale_id and studio_id=st.studio_id for update;
 select value into option from jsonb_array_elements(public.get_trial_enrollment_credit_options(st.id)) where value->>'payment_id'=target_source_payment_id::text limit 1;
 if option is null then raise exception 'trial_credit_unavailable'; end if;
 select (clock_timestamp() at time zone coalesce(timezone,'America/Mexico_City'))::date into today from public.studios where id=st.studio_id;
 select * into pkg from public.product_templates where id=target_package_product_id and studio_id=st.studio_id and active and product_type in ('package','membership');
 if not found then raise exception 'package_not_available'; end if;
 select * into enroll from public.product_templates where id=target_enrollment_product_id and studio_id=st.studio_id and active and product_type='enrollment';
 if enroll.id is null or enroll.price_minor<15000 or enroll.currency<>'MXN' or pkg.currency<>'MXN' then raise exception 'trial_credit_enrollment_invalid'; end if;
 total:=pkg.price_minor+enroll.price_minor-15000;
 if initial_payment_minor is distinct from total then raise exception 'trial_credit_full_payment_required'; end if;
 if nullif(trim(payment_method),'') is null then raise exception 'payment_method_required'; end if;
 if payment_effective_on is distinct from today then raise exception 'trial_credit_same_day_required'; end if;
 core:=public.create_student_onboarding_sale_v2(st.id,pkg.id,enroll.id,target_idempotency_key,package_start_mode,package_starts_on,
  0,null,null,null,'exception',today,'Abono de primera clase: pago original '||source.id::text,
  0,null,null,null,null,null,'Aplicación de abono de primera clase',true,'Compra liquidada en esta misma operación',0,null);
 sale:=(core->>'sale_id')::uuid;
 select sl.id into line from public.sale_lines sl where sl.sale_id=sale and sl.studio_id=st.studio_id and sl.product_template_id=enroll.id;
 if line is null then raise exception 'trial_credit_enrollment_invalid'; end if;
 update public.sale_lines set discount_minor=15000,discount_kind='promotion',discount_input='Abono primera clase',
  discount_reason='Abono de $150 ya cobrado. Pago original: '||source.id::text,discount_authorized_by=(select auth.uid()),line_total_minor=unit_price_minor-15000 where id=line;
 update public.student_enrollments set resolution_type='paid',resolution_reason='Abono primera clase: '||source.id::text where source_sale_line_id=line;
 update public.sales set total_minor=total,payment_due_on=null,collection_note=null,pending_access_exception=false,pending_access_exception_by=null,pending_access_exception_reason=null,updated_at=now() where id=sale;
 update public.product_acquisitions set access_blocked=false,updated_at=now() where sale_line_id in (select id from public.sale_lines where sale_id=sale);
 insert into public.payments(studio_id,sale_id,kind,amount_minor,method,reference,notes,effective_on,created_by)
 values(st.studio_id,sale,'payment',initial_payment_minor,trim(payment_method),nullif(trim(payment_reference),''),nullif(trim(payment_notes),''),today,(select auth.uid()));
 insert into public.trial_enrollment_credits(studio_id,student_id,source_payment_id,source_sale_id,reservation_id,target_sale_id,target_sale_line_id,amount_minor,effective_on,created_by)
 values(st.studio_id,st.id,source.id,source.sale_id,(option->>'reservation_id')::uuid,sale,line,15000,today,(select auth.uid()));
 return jsonb_build_object('ok',true,'replayed',false,'sale_id',sale,'total_minor',total,'paid_minor',initial_payment_minor,'balance_minor',0,'trial_credit_minor',15000);
end; $$;
revoke all on function public.create_package_with_trial_enrollment_credit(uuid,uuid,uuid,uuid,uuid,text,date,integer,text,date,text,text) from public,anon;
grant execute on function public.create_package_with_trial_enrollment_credit(uuid,uuid,uuid,uuid,uuid,text,date,integer,text,date,text,text) to authenticated;

-- A used receipt cannot be refunded or voided independently of its linked credit.
create function private.guard_applied_trial_credit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='payments' then
  if new.kind='refund' then
   perform 1 from public.sales where id=new.sale_id for update;
   if exists(select 1 from public.trial_enrollment_credits where source_sale_id=new.sale_id) then raise exception 'trial_credit_source_already_applied'; end if;
  end if;
 elsif new.status='voided' and old.status is distinct from new.status then
  if exists(select 1 from public.trial_enrollment_credits where source_sale_id=new.id) then raise exception 'trial_credit_source_already_applied'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.guard_applied_trial_credit() from public,anon,authenticated;
create trigger guard_applied_trial_credit_refund before insert on public.payments for each row execute function private.guard_applied_trial_credit();
create trigger guard_applied_trial_credit_void before update of status on public.sales for each row execute function private.guard_applied_trial_credit();
