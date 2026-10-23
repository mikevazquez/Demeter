-- NEB-01 · Test doubles for base Supabase services; never apply this fixture to Sandbox/production.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
grant usage on schema auth, private, public to anon, authenticated;
create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.studios (id uuid primary key default gen_random_uuid(), name text not null, slug text unique, timezone text not null default 'America/Mexico_City', currency text not null default 'MXN');
create table public.studio_memberships (studio_id uuid references public.studios(id), user_id uuid references auth.users(id), role text, active boolean default true, primary key (studio_id, user_id));
create table public.role_capabilities (role text, capability_key text);
insert into public.role_capabilities values ('owner', 'settings.write'), ('admin', 'settings.write');

create or replace function private.has_capability(p_studio_id uuid, p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_memberships m join public.role_capabilities rc on rc.role = m.role
    where m.studio_id = p_studio_id and m.user_id = (select auth.uid()) and m.active = true and rc.capability_key = p_capability);
$$;
grant execute on function private.has_capability(uuid, text) to authenticated;

-- Existing studio before Nébora (Demeter) must be backfilled as All Access.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1'), -- Mike (platform admin)
  ('00000000-0000-0000-0000-0000000000b1'), -- owner of studio B
  ('00000000-0000-0000-0000-0000000000c1'); -- coach of studio B
insert into public.studios (id, name, slug) values ('10000000-0000-0000-0000-000000000001', 'Demeter Fitness', 'demeter-fitness');
grant select on public.studios, public.studio_memberships to authenticated;

-- Minimal stand-ins for the tables NEB-01-03 guards (only id + studio_id matter).
create table public.sales (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), status text not null default 'confirmed', total_minor bigint not null default 0, created_at timestamptz not null default now());
create table public.reservations (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), status text not null default 'reserved', booked_at timestamptz not null default now());
create table public.reward_programs (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.reward_challenge_enrollments (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.evaluation_templates (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.technical_evaluations (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.evaluation_invitations (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.resources (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.space_maps (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));
create table public.reservation_resource_assignments (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id));

-- NEB-01-10/11 · stand-ins for the console reads (only the columns they read).
create table public.students (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), active boolean not null default true, created_at timestamptz not null default now());
create table public.product_acquisitions (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), student_id uuid not null, status text not null default 'active', expires_on date);
create table public.class_sessions (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), starts_at timestamptz not null, status text not null default 'scheduled');
create table public.assistant_model_calls (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), input_tokens integer not null default 0, output_tokens integer not null default 0, estimated_cost_usd_micros bigint not null default 0, created_at timestamptz not null default now());

-- NEB-01-35 · stand-in for payments (only what the local-date trigger touches).
create table public.payments (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), amount_minor integer not null default 0, effective_on date not null default current_date);
-- Production shape of register_sale_payment around the payment date (the rest is irrelevant here).
create function public.register_sale_payment(target_sale_id uuid, payment_amount_minor integer, payment_method text,
  payment_reference text default null, payment_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_sale record;
begin
  insert into public.payments(studio_id,amount_minor,effective_on)
  values(v_sale.studio_id,payment_amount_minor,
    nullif(trim(coalesce(payment_notes,'')),''),
    current_date,(select auth.uid()));
  return '{}'::jsonb;
end;
$function$;

-- NEB-01-38/39/40 · stand-ins for booking windows (only what the rules and patches touch).
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
grant execute on function auth.role() to anon, authenticated, service_role;
insert into public.role_capabilities values ('owner', 'schedule.write'), ('owner', 'schedule.read'), ('coach', 'attendance.write');
create table public.class_templates (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), name text not null default 'Clase');
alter table public.class_sessions add column template_id uuid references public.class_templates(id);
alter table public.reservations add column student_id uuid references public.students(id), add column session_id uuid references public.class_sessions(id);
create table public.studio_operating_policies (
  studio_id uuid primary key references public.studios(id),
  cancellation_cutoff_minutes integer not null default 300,
  late_cancellation_consumes_credit boolean not null default true,
  no_show_consumes_credit boolean not null default true,
  default_minimum_reservations_enabled boolean not null default false,
  default_minimum_reservations integer not null default 2,
  default_minimum_review_minutes_before integer not null default 120,
  default_minimum_override_allowed boolean not null default true,
  unlimited_late_cancellation_penalty_minor integer not null default 0,
  unlimited_no_show_penalty_minor integer not null default 0,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now());
create table public.class_waitlist_entries (id uuid primary key default gen_random_uuid(), studio_id uuid not null, session_id uuid not null, student_id uuid not null, status text not null default 'active');
create type public.reservation_status as enum ('reserved','attended','cancelled_on_time','cancelled_late','no_show','cancelled_by_studio');

-- Old-style functions with the exact fixed texts the migration replaces.
create function private.reservation_cancellation_outcome(target_studio_id uuid, target_starts_at timestamptz)
returns public.reservation_status language sql stable as $$ select 'cancelled_late'::public.reservation_status $$;
create function public.cancel_reservation(target_reservation_id uuid, target_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.class_sessions%rowtype;
  v_new_status public.reservation_status;
begin
  select * into v_reservation from public.reservations where id = target_reservation_id;
  select * into v_session from public.class_sessions where id = v_reservation.session_id;
  v_new_status := private.reservation_cancellation_outcome(v_reservation.studio_id, v_session.starts_at);
  return v_new_status::text;
end;
$$;
create function public.check_in_reservation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.class_sessions%rowtype;
begin
  select * into v_session from public.class_sessions where id = p_token::uuid;
  if clock_timestamp() < v_session.starts_at - interval '210 minutes' then
    return jsonb_build_object('status', 'too_early', 'available_at', v_session.starts_at - interval '210 minutes');
  end if;
  if clock_timestamp() >= v_session.starts_at + interval '30 minutes' then
    return jsonb_build_object('status', 'closed');
  end if;
  return jsonb_build_object('status', 'checked_in');
end;
$$;
create function private.booking_eligibility_core(target_session_id uuid, target_student_id uuid, p_allow_started_session boolean default false)
returns jsonb language sql stable as $$ select jsonb_build_object('eligible', true, 'reason_code', null) $$;
create function private.booking_eligibility_regular_program_baseline(target_session_id uuid, target_student_id uuid)
returns jsonb language sql stable as $$ select jsonb_build_object('eligible', true, 'reason_code', null) $$;
create function public.booking_eligibility(target_session_id uuid,target_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_program uuid;
begin
 if v_program is null then return private.booking_eligibility_regular_program_baseline(target_session_id,target_student_id); end if;
 return private.booking_eligibility_core(target_session_id,target_student_id,false);
end;
$$;
grant execute on function public.booking_eligibility(uuid,uuid), public.cancel_reservation(uuid,text), public.check_in_reservation(text) to authenticated;
alter table public.students add column user_id uuid;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1');

-- NEB-01-41 · stand-ins for penalties.
insert into public.role_capabilities values ('owner', 'students.write');
alter table public.product_acquisitions add column unlimited boolean not null default false;
alter table public.reservations add column acquisition_id uuid references public.product_acquisitions(id), add column cancelled_at timestamptz;
create table public.student_operating_charges (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null, student_id uuid not null,
  reservation_id uuid not null, acquisition_id uuid, charge_type text not null, amount_minor integer not null,
  currency text not null, status text not null default 'pending', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), resolved_at timestamptz, resolved_by_user_id uuid, resolution_note text,
  unique (reservation_id, charge_type));

-- NEB-01-36 · stand-ins: real (current) definitions of the functions the migration adjusts.
create table public.trial_booking_policies (studio_id uuid primary key references public.studios(id), enabled boolean not null default true, updated_at timestamptz not null default now());
create table public.assistant_admin_rules (id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id), rule_key text not null, category text not null default 'behavior', instruction text not null, enabled boolean not null default true, created_by uuid, updated_by uuid, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), unique (studio_id, rule_key));
create table public.trial_enrollment_credits (id uuid primary key default gen_random_uuid(), studio_id uuid not null, amount_minor integer not null check (amount_minor=15000));


create or replace function public.assistant_trial_booking_preview(target_studio_id uuid,target_session_id uuid,target_student_id uuid default null,target_crm_contact_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; student uuid; payment_activation boolean; credit jsonb;
begin
 r:=private.assistant_trial_booking_preview_demi2_base(target_studio_id,target_session_id,target_student_id,target_crm_contact_id);
 student:=coalesce(target_student_id,(select converted_student_id from public.crm_contacts where id=target_crm_contact_id and studio_id=target_studio_id));
 if student is not null and exists(select 1 from public.students where id=student and studio_id=target_studio_id and student_type<>'trial') then return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_identity_required'); end if;
 payment_activation:=auth.role()='service_role' and exists(select 1 from public.assistant_transfer_purchase_intents i where i.id::text=current_setting('demi.trial_payment_activation',true) and i.studio_id=target_studio_id and i.student_id=student and i.session_id=target_session_id and i.intent_kind='trial_class' and i.status='awaiting_receipt' and i.expires_at>clock_timestamp());
 if payment_activation and r->>'reason_code'='trial_prepayment_required' then
  r:=r||jsonb_build_object('ok',true,'eligible',true,'trial_exception',true,'reason_code',null);
 end if;
 if not coalesce((r->>'eligible')::boolean,false) and r->>'reason_code' is distinct from 'trial_prepayment_required' then return r; end if;
 if student is not null and not payment_activation and exists(select 1 from public.assistant_transfer_purchase_intents i where i.studio_id=target_studio_id and i.student_id=student and i.intent_kind='trial_class' and i.acquisition_id is not null) then
  credit:=private.booking_eligibility_core(target_session_id,student,false);
  if coalesce((credit->>'eligible')::boolean,false) then
   return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_credit_requires_standard_booking');
  end if;
  return jsonb_build_object('ok',false,'eligible',false,'reason_code','trial_credit_payment_required','prepayment_required',true,'amount_minor',15000,'currency',upper(coalesce((select currency from public.studios where id=target_studio_id),'MXN')));
 end if;
 return r;
end; $$;

create or replace function public.service_prepare_trial_transfer(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_resource_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_policy public.trial_booking_policies%rowtype;
  v_student public.students%rowtype;
  v_session public.class_sessions%rowtype;
  v_template public.class_templates%rowtype;
  v_bank public.studio_bank_transfer_settings%rowtype;
  v_product public.product_templates%rowtype;
  v_attended integer := 0;
  v_active integer := 0;
  v_occupied integer := 0;
  v_intent_id uuid;
  v_currency text;
begin
  if target_studio_id is null or target_conversation_id is null or target_student_id is null or target_session_id is null then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'schedule.write') then
    raise exception 'forbidden';
  end if;

  select * into v_policy from public.trial_booking_policies where studio_id=target_studio_id;
  if not found or not v_policy.enabled then
    return jsonb_build_object('ok',false,'reason_code','trial_booking_disabled');
  end if;
  if not private.demi_requires_trial_prepay(target_studio_id) then
    return jsonb_build_object('ok',false,'reason_code','trial_prepay_not_enabled');
  end if;
  if v_policy.trial_payment_product_template_id is null then
    return jsonb_build_object('ok',false,'reason_code','trial_payment_product_missing');
  end if;

  select * into v_student
  from public.students
  where id=target_student_id and studio_id=target_studio_id
    and active=true and lifecycle_status='active'
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_operable'); end if;
  if v_student.student_type <> 'trial' then
    return jsonb_build_object('ok',false,'reason_code','trial_identity_required');
  end if;

  if not exists(
    select 1 from public.assistant_conversations c
    where c.id=target_conversation_id and c.studio_id=target_studio_id and c.student_id=target_student_id
  ) then
    return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch');
  end if;

  select count(*)::integer into v_attended
  from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='attended';
  if v_attended>0 then
    return jsonb_build_object('ok',false,'reason_code','trial_completed_enrollment_required');
  end if;

  select count(*)::integer into v_active
  from public.reservations r
  where r.studio_id=target_studio_id and r.student_id=target_student_id and r.status='reserved';
  if v_active>=v_policy.max_active_trial_reservations then
    return jsonb_build_object('ok',false,'reason_code','trial_active_booking_exists');
  end if;

  select * into v_session
  from public.class_sessions
  where id=target_session_id and studio_id=target_studio_id
  for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=clock_timestamp() then
    return jsonb_build_object('ok',false,'reason_code','session_not_bookable');
  end if;

  select count(*)::integer into v_occupied
  from public.reservations
  where session_id=target_session_id and status in ('reserved','attended');
  if v_occupied>=v_session.capacity then
    return jsonb_build_object('ok',false,'reason_code','session_full');
  end if;

  if coalesce(v_session.requires_resource,false) then
    if target_resource_id is null then
      return jsonb_build_object('ok',false,'reason_code','resource_selection_required');
    end if;
    if not exists(
      select 1
      from public.session_resources sr
      join public.resources r on r.id=sr.resource_id and r.studio_id=sr.studio_id
      where sr.studio_id=target_studio_id
        and sr.session_id=target_session_id
        and sr.resource_id=target_resource_id
        and sr.enabled=true and r.active=true
    ) then
      return jsonb_build_object('ok',false,'reason_code','resource_not_available');
    end if;
  end if;

  select * into v_template
  from public.class_templates
  where id=v_session.template_id and studio_id=target_studio_id and active=true;
  if not found or coalesce(15000,0)<=0 then
    return jsonb_build_object('ok',false,'reason_code','trial_price_unavailable');
  end if;

  select * into v_product
  from public.product_templates
  where id=v_policy.trial_payment_product_template_id and studio_id=target_studio_id;
  if not found then return jsonb_build_object('ok',false,'reason_code','trial_payment_product_missing'); end if;

  if not exists(
    select 1 from public.studio_payment_methods spm
    where spm.studio_id=target_studio_id and spm.active=true
      and (spm.code='bank_transfer' or spm.category='transfer')
  ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_not_available');
  end if;

  select * into v_bank
  from public.studio_bank_transfer_settings
  where studio_id=target_studio_id and enabled=true;
  if not found
     or nullif(trim(coalesce(v_bank.bank_name,'')),'') is null
     or nullif(trim(coalesce(v_bank.account_holder,'')),'') is null
     or (
       nullif(trim(coalesce(v_bank.clabe,'')),'') is null
       and nullif(trim(coalesce(v_bank.account_number,'')),'') is null
       and nullif(trim(coalesce(v_bank.card_number,'')),'') is null
     ) then
    return jsonb_build_object('ok',false,'reason_code','bank_transfer_details_not_configured');
  end if;

  select upper(coalesce(currency,'MXN')) into v_currency from public.studios where id=target_studio_id;

  update public.assistant_transfer_purchase_intents
  set status='cancelled',updated_at=clock_timestamp()
  where studio_id=target_studio_id and conversation_id=target_conversation_id
    and intent_kind='trial_class' and status='awaiting_receipt';

  insert into public.assistant_transfer_purchase_intents(
    studio_id,conversation_id,student_id,session_id,product_template_id,
    amount_minor,currency,status,intent_kind,resource_id
  )
  values(
    target_studio_id,target_conversation_id,target_student_id,target_session_id,
    v_product.id,15000,v_currency,'awaiting_receipt',
    'trial_class',case when v_session.requires_resource then target_resource_id else null end
  )
  returning id into v_intent_id;

  return jsonb_build_object(
    'ok',true,'status','awaiting_receipt','intent_id',v_intent_id,
    'amount_minor',15000,'currency',v_currency,
    'bank_details',jsonb_build_object(
      'bank_name',v_bank.bank_name,'account_holder',v_bank.account_holder,
      'clabe',v_bank.clabe,'account_number',v_bank.account_number,
      'card_number',v_bank.card_number,'instructions',v_bank.instructions
    ),
    'receipt_required',true,'reservation_confirmed',false,
    'activation_rule','confirm_trial_on_matching_receipt'
  );
end;
$function$;


create or replace function public.get_trial_enrollment_credit_options(target_student_id uuid)
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

create or replace function public.create_package_with_trial_enrollment_credit(
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

-- NEB-01-37 · stand-ins: follow-up settings and the current scheduling function.
create table public.demi_followup_settings (studio_id uuid primary key references public.studios(id), enabled boolean not null default false, prospect_interval_hours integer not null default 24, templates jsonb not null default '{}');
CREATE OR REPLACE FUNCTION public.service_schedule_demi_followups(p_studio uuid, p_conversation uuid, p_kind text, p_source_ref text, p_source_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.assistant_conversations%rowtype; person uuid; delays interval[]; i integer; settings public.demi_followup_settings%rowtype; payment_group public.demi_group_bookings%rowtype; v_source_ref text:=p_source_ref; v_source_at timestamptz:=p_source_at;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into settings from public.demi_followup_settings where studio_id=p_studio and enabled;
 if not found then return jsonb_build_object('ok',false,'reason_code','followups_disabled'); end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 select person_id into person from public.students where id=c.student_id and studio_id=p_studio;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=p_studio; end if;
 if person is null then return jsonb_build_object('ok',false,'reason_code','identity_required'); end if;
 if nullif(p_source_ref,'') is null or p_source_at is null then return jsonb_build_object('ok',false,'reason_code','source_required'); end if;
 if p_kind='prospect' then
  select * into payment_group from public.demi_group_bookings where studio_id=p_studio and conversation_id=p_conversation and status='awaiting_receipt' order by created_at desc limit 1;
  if found then
   v_source_ref:='payment:'||payment_group.id; v_source_at:=payment_group.created_at;
   update public.demi_followups set state='cancelled',reason_code='payment_requested',lease_token=null,lease_until=null
    where studio_id=p_studio and conversation_id=p_conversation and kind='prospect' and source_ref<>('payment:'||payment_group.id) and state in ('pending','processing');
  end if;
 end if;
 if payment_group.id is not null then delays:=array[interval '2 hours',interval '6 hours'];
 elsif p_kind in ('prospect','post_trial') then delays:=array[make_interval(hours=>settings.prospect_interval_hours),make_interval(hours=>settings.prospect_interval_hours*2)];
 elsif p_kind in ('package','enrollment') then delays:=array[interval '7 days',interval '15 days',interval '30 days'];
 elsif p_kind='inactive' then delays:=array[interval '14 days'];
 elsif p_kind='package_expiring' then delays:=array[interval '-3 days'];
 elsif p_kind='package_expired' then delays:=array[interval '0 days'];
 else return jsonb_build_object('ok',false,'reason_code','invalid_kind'); end if;
 if p_kind in ('prospect','post_trial') and private.demi_group_has_active_reservation(p_studio,p_conversation) then return jsonb_build_object('ok',true,'steps',0,'reason_code','group_reservation_exists'); end if;
 for i in 1..array_length(delays,1) loop
  insert into public.demi_followups(studio_id,person_id,conversation_id,kind,source_ref,source_at,step,due_at)
  values(p_studio,person,c.id,p_kind,v_source_ref,v_source_at,i,v_source_at+delays[i]) on conflict do nothing;
 end loop;
 return jsonb_build_object('ok',true,'steps',array_length(delays,1));
end; $function$;


-- NEB-01-17/18 · stand-ins for the support reads and the configuration review.
create table if not exists public.product_templates (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  name text not null, product_type text not null default 'package', price_minor integer not null default 0,
  credit_limit integer, validity_days integer, unlimited boolean not null default false,
  active boolean not null default true, online_purchasable boolean not null default false,
  updated_at timestamptz not null default now());
alter table public.class_sessions add column if not exists ends_at timestamptz,
  add column if not exists capacity integer not null default 10,
  add column if not exists instructor_id uuid, add column if not exists coach_user_id uuid;
alter table public.class_templates add column if not exists active boolean not null default true,
  add column if not exists workshop_offer_id uuid, add column if not exists drop_in_price_minor integer;
alter table public.students add column if not exists person_id uuid,
  add column if not exists lifecycle_status text not null default 'active';
create table if not exists public.studio_payment_methods (studio_id uuid not null, code text not null, active boolean not null default true);
create table if not exists public.profile_field_definitions (id uuid primary key default gen_random_uuid(), studio_id uuid not null, entity_type text not null, key text not null, active boolean not null default true);
create table if not exists public.profile_field_values (id uuid primary key default gen_random_uuid(), studio_id uuid not null, person_id uuid not null, definition_id uuid not null, value jsonb);
alter table public.sales add column if not exists payment_due_on date;

-- NEB-01-21 · Demi usage columns.
alter table public.assistant_model_calls add column if not exists conversation_id uuid,
  add column if not exists model text, add column if not exists cached_input_tokens integer not null default 0,
  add column if not exists status text not null default 'completed';
