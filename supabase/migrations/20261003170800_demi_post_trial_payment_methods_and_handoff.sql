create table if not exists public.assistant_enrollment_intents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrollment_product_template_id uuid not null references public.product_templates(id),
  target_session_id uuid references public.class_sessions(id) on delete set null,
  reservation_id uuid references public.reservations(id) on delete set null,
  payment_method text not null check (payment_method in ('cash','bank_transfer','app')),
  status text not null check (status in ('cash_due','receipt_required','online_pending','human_review','approved','rejected','cancelled')),
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null,
  receipt_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_enrollment_intents_student_idx
  on public.assistant_enrollment_intents(studio_id,student_id,created_at desc);

create table if not exists public.assistant_handoffs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  reason_code text not null,
  note text,
  status text not null default 'open' check (status in ('open','resolved','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.assistant_enrollment_intents enable row level security;
alter table public.assistant_handoffs enable row level security;
revoke all on public.assistant_enrollment_intents from anon, authenticated;
revoke all on public.assistant_handoffs from anon, authenticated;
grant all on public.assistant_enrollment_intents to service_role;
grant all on public.assistant_handoffs to service_role;

create or replace function private.promote_trial_student_from_enrollment()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if new.status='active' and new.refunded_at is null then
    update public.students
    set student_type='regular',
        trial_status=case when student_type='trial' then 'converted'::public.trial_status else trial_status end,
        updated_at=now()
    where id=new.student_id and studio_id=new.studio_id and student_type='trial';
  end if;
  return new;
end;
$function$;

drop trigger if exists assistant_promote_trial_from_enrollment on public.student_enrollments;
create trigger assistant_promote_trial_from_enrollment
after insert or update of status,refunded_at on public.student_enrollments
for each row execute function private.promote_trial_student_from_enrollment();

create or replace function public.assistant_post_trial_requirement(target_studio_id uuid,target_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_student public.students%rowtype; v_policy public.enrollment_policies%rowtype;
  v_product public.product_templates%rowtype; v_attended integer:=0;
  v_has_enrollment boolean:=false; v_timezone text; v_today date;
  v_blockers jsonb:='[]'::jsonb; v_account_status text; v_must_change_password boolean;
begin
  if target_studio_id is null or target_student_id is null then return jsonb_build_object('ok',false,'reason_code','invalid_input'); end if;
  select * into v_student from public.students where id=target_student_id and studio_id=target_studio_id;
  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_found'); end if;
  select count(*)::integer into v_attended from public.reservations where studio_id=target_studio_id and student_id=target_student_id and status='attended';
  if v_attended=0 then return jsonb_build_object('ok',true,'post_trial',false,'attended_count',0); end if;
  select coalesce(timezone,'America/Mexico_City') into v_timezone from public.studios where id=target_studio_id;
  v_today:=(clock_timestamp() at time zone v_timezone)::date;
  v_has_enrollment:=private.student_has_active_enrollment(target_studio_id,target_student_id,v_today);
  select * into v_policy from public.enrollment_policies where studio_id=target_studio_id;
  if found and v_policy.enrollment_product_template_id is not null then
    select * into v_product from public.product_templates
    where id=v_policy.enrollment_product_template_id and studio_id=target_studio_id and active=true and product_type='enrollment'::public.product_type;
  end if;
  if v_has_enrollment then v_blockers:=coalesce(private.student_booking_blockers(target_student_id,null),'[]'::jsonb); end if;
  if v_student.user_id is not null then
    select ua.status::text,ua.must_change_password into v_account_status,v_must_change_password
    from public.user_accounts ua where ua.id=v_student.user_id;
  end if;
  return jsonb_build_object(
    'ok',true,'post_trial',true,'attended_count',v_attended,
    'enrollment_required',coalesce(v_policy.enabled,false) and coalesce(v_policy.required_for_booking,false) and not v_has_enrollment,
    'has_active_enrollment',v_has_enrollment,
    'enrollment_product',case when v_product.id is null then null else jsonb_build_object(
      'id',v_product.id,'name',v_product.name,'price_minor',v_product.price_minor,
      'currency',upper(v_product.currency),'online_purchasable',v_product.online_purchasable) end,
    'booking_blockers',v_blockers,
    'documents_pending',exists(select 1 from jsonb_array_elements(v_blockers) blocker(item) where item->>'action_kind' in ('documents','profile')),
    'access_state',case when v_student.user_id is null then 'not_provisioned'
      when v_account_status='active' and coalesce(v_must_change_password,false) then 'activation_pending'
      when v_account_status='active' and coalesce(v_must_change_password,false)=false then 'active' else 'inconsistent' end,
    'payment_methods',jsonb_build_array('cash','bank_transfer','app')
  );
end;
$function$;

create or replace function public.assistant_create_post_trial_reservation(
  target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_session_id uuid,target_payment_method text
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_method text:=lower(trim(coalesce(target_payment_method,''))); v_student public.students%rowtype;
  v_session public.class_sessions%rowtype; v_template public.class_templates%rowtype;
  v_policy public.enrollment_policies%rowtype; v_product public.product_templates%rowtype;
  v_attended integer:=0; v_occupied integer:=0; v_reservation_id uuid; v_intent_id uuid;
  v_existing public.assistant_enrollment_intents%rowtype; v_tz text; v_today date;
begin
  if v_method not in ('cash','bank_transfer') then return jsonb_build_object('ok',false,'reason_code','payment_method_not_supported'); end if;
  if coalesce((select auth.role()),'')<>'service_role' and not private.has_capability(target_studio_id,'schedule.write') then raise exception 'forbidden'; end if;
  select * into v_student from public.students where id=target_student_id and studio_id=target_studio_id for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','student_not_found'); end if;
  if not v_student.active or v_student.lifecycle_status<>'active' then return jsonb_build_object('ok',false,'reason_code','student_not_operable'); end if;
  select count(*)::integer into v_attended from public.reservations where studio_id=target_studio_id and student_id=target_student_id and status='attended';
  if v_attended<1 then return jsonb_build_object('ok',false,'reason_code','post_trial_not_reached'); end if;
  select coalesce(timezone,'America/Mexico_City') into v_tz from public.studios where id=target_studio_id;
  v_today:=(clock_timestamp() at time zone v_tz)::date;
  if private.student_has_active_enrollment(target_studio_id,target_student_id,v_today) then return jsonb_build_object('ok',false,'reason_code','enrollment_already_active'); end if;
  select * into v_policy from public.enrollment_policies where studio_id=target_studio_id;
  if not found or not v_policy.enabled or v_policy.enrollment_product_template_id is null then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;
  select * into v_product from public.product_templates where id=v_policy.enrollment_product_template_id and studio_id=target_studio_id and active=true and product_type='enrollment'::public.product_type;
  if not found then return jsonb_build_object('ok',false,'reason_code','enrollment_product_not_configured'); end if;
  select * into v_session from public.class_sessions where id=target_session_id and studio_id=target_studio_id for update;
  if not found then return jsonb_build_object('ok',false,'reason_code','session_not_found'); end if;
  if v_session.status<>'scheduled' or v_session.starts_at<=now() then return jsonb_build_object('ok',false,'reason_code','session_not_bookable'); end if;
  if coalesce(v_session.requires_resource,false) then return jsonb_build_object('ok',false,'reason_code','resource_selection_required'); end if;
  select * into v_template from public.class_templates where id=v_session.template_id and studio_id=target_studio_id;
  select count(*)::integer into v_occupied from public.reservations where session_id=target_session_id and status in ('reserved','attended');
  if v_occupied>=v_session.capacity then return jsonb_build_object('ok',false,'reason_code','session_full'); end if;
  if exists(select 1 from public.reservations where studio_id=target_studio_id and session_id=target_session_id and student_id=target_student_id and status in ('reserved','attended')) then return jsonb_build_object('ok',false,'reason_code','already_reserved'); end if;
  select * into v_existing from public.assistant_enrollment_intents
  where studio_id=target_studio_id and student_id=target_student_id and target_session_id=target_session_id
    and status in ('cash_due','receipt_required','human_review','online_pending')
  order by created_at desc limit 1;
  if found then return jsonb_build_object('ok',true,'reused',true,'intent_id',v_existing.id,'reservation_id',v_existing.reservation_id,
    'payment_method',v_existing.payment_method,'status',v_existing.status,'enrollment_amount_minor',v_existing.amount_minor,'currency',v_existing.currency); end if;
  insert into public.reservations(studio_id,session_id,student_id,student_user_id,acquisition_id,status,credits_held,commercial_status)
  values(target_studio_id,target_session_id,target_student_id,v_student.user_id,null,'reserved',greatest(coalesce(v_template.credit_cost,1),1),'payment_pending')
  returning id into v_reservation_id;
  insert into public.assistant_reservation_links(studio_id,reservation_id,assistant_conversation_id,source)
  values(target_studio_id,v_reservation_id,target_conversation_id,'assistant_post_trial')
  on conflict(studio_id,reservation_id) do nothing;
  insert into public.assistant_enrollment_intents(studio_id,conversation_id,student_id,enrollment_product_template_id,target_session_id,reservation_id,payment_method,status,amount_minor,currency)
  values(target_studio_id,target_conversation_id,target_student_id,v_product.id,target_session_id,v_reservation_id,v_method,
    case when v_method='cash' then 'cash_due' else 'receipt_required' end,v_product.price_minor,upper(v_product.currency))
  returning id into v_intent_id;
  perform public.emit_domain_event(
    p_studio_id=>target_studio_id,p_event_type=>'booking.created',p_source_entity_type=>'reservation',
    p_source_entity_id=>v_reservation_id,p_deduplication_key=>'booking.created:assistant-post-trial:'||v_reservation_id::text,
    p_actor_user_id=>(select auth.uid()),p_payload=>jsonb_build_object('reservation_id',v_reservation_id,'session_id',target_session_id,
      'student_id',target_student_id,'source','assistant_post_trial','commercial_status','payment_pending','enrollment_payment_method',v_method));
  return jsonb_build_object('ok',true,'reused',false,'intent_id',v_intent_id,'reservation_id',v_reservation_id,
    'payment_method',v_method,'status',case when v_method='cash' then 'cash_due' else 'receipt_required' end,
    'enrollment_amount_minor',v_product.price_minor,'currency',upper(v_product.currency),
    'class_amount_minor',v_template.drop_in_price_minor,'review_required',v_method='bank_transfer');
end;
$function$;

create or replace function public.assistant_create_handoff(
  target_studio_id uuid,target_conversation_id uuid,target_student_id uuid,target_reason_code text,target_note text default null
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
  if coalesce((select auth.role()),'')<>'service_role' and not private.has_capability(target_studio_id,'settings.write') then raise exception 'forbidden'; end if;
  select id into v_id from public.assistant_handoffs where studio_id=target_studio_id and conversation_id=target_conversation_id and status='open'
  order by created_at desc limit 1;
  if v_id is null then
    insert into public.assistant_handoffs(studio_id,conversation_id,student_id,reason_code,note,status)
    values(target_studio_id,target_conversation_id,target_student_id,left(coalesce(nullif(trim(target_reason_code),''),'human_review'),120),
      nullif(left(trim(coalesce(target_note,'')),1000),''),'open') returning id into v_id;
  end if;
  return jsonb_build_object('ok',true,'handoff_id',v_id,'status','open');
end;
$function$;

create or replace function private.assistant_enforce_payment_before_attendance()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if new.status='attended' and coalesce(new.commercial_status::text,'')='payment_pending'
     and exists(select 1 from public.assistant_reservation_links l where l.studio_id=new.studio_id and l.reservation_id=new.id and l.source in ('assistant_trial','assistant_post_trial'))
  then raise exception 'assistant_payment_required'; end if;
  return new;
end;
$function$;

drop trigger if exists assistant_enforce_payment_before_attendance on public.reservations;
create trigger assistant_enforce_payment_before_attendance
before insert or update of status,commercial_status on public.reservations
for each row execute function private.assistant_enforce_payment_before_attendance();

revoke all on function public.assistant_create_post_trial_reservation(uuid,uuid,uuid,uuid,text) from public;
revoke all on function public.assistant_create_handoff(uuid,uuid,uuid,text,text) from public;
grant execute on function public.assistant_create_post_trial_reservation(uuid,uuid,uuid,uuid,text) to authenticated,service_role;
grant execute on function public.assistant_create_handoff(uuid,uuid,uuid,text,text) to authenticated,service_role;
