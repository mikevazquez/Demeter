-- Sandbox-only iteration; depends on workshop v2 schema, not a release manifest.
create table private.workshop_payment_authorizations (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 offer_id uuid not null references public.workshop_offers(id),
 student_id uuid not null references public.students(id),
 request_id uuid not null,
 selection_mode text not null check(selection_mode in ('full','sessions')),
 session_ids uuid[] not null,
 amount_minor integer not null check(amount_minor>0),
 currency text not null check(currency='MXN'),
 method text not null check(method in ('cash','transfer')),
 reference text,
 verified_by uuid not null references auth.users(id),
 verified_at timestamptz not null default clock_timestamp(),
 consumed_purchase_id uuid references public.workshop_purchases(id),
 unique(studio_id,request_id)
);
alter table private.workshop_payment_authorizations enable row level security;
revoke all on private.workshop_payment_authorizations from public,anon,authenticated,service_role;

create function private.guard_workshop_payment_authorization()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'payment_authorization_immutable'; end if;
 if (to_jsonb(new)-'consumed_purchase_id') is distinct from (to_jsonb(old)-'consumed_purchase_id')
    or old.consumed_purchase_id is not null or new.consumed_purchase_id is null then
   raise exception 'payment_authorization_immutable';
 end if;
 return new;
end $$;
create trigger immutable_workshop_payment_authorization before update or delete
on private.workshop_payment_authorizations for each row execute function private.guard_workshop_payment_authorization();

create function private.admin_confirm_workshop_payment(
 p_offer_id uuid,p_student_id uuid,p_session_ids uuid[],p_purchase_mode text,
 p_request_id uuid,p_amount_minor integer,p_method text,p_reference text,p_verified boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 st uuid; actor uuid:=auth.uid(); a private.workshop_payment_authorizations%rowtype;
 chosen uuid[]; receipt jsonb;
begin
 if actor is null then raise exception 'unauthenticated'; end if;
 select studio_id into st from public.workshop_offers where id=p_offer_id;
 if st is null then raise exception 'offer_not_found'; end if;
 if not coalesce(private.has_capability(st,'sales.write'),false)
    or not coalesce(private.has_capability(st,'schedule.write'),false)
    or not exists(select 1 from public.user_accounts where id=actor and status='active')
    or not exists(select 1 from public.studios where id=st and status='active') then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.studios where id=st and currency='MXN') then raise exception 'unsupported_currency'; end if;
 if p_verified is distinct from true then raise exception 'payment_review_required'; end if;
 if p_method is null or p_method not in ('cash','transfer') then raise exception 'invalid_payment_method'; end if;
 if p_method='transfer' and nullif(btrim(p_reference),'') is null then raise exception 'transfer_reference_required'; end if;
 if p_request_id is null or p_amount_minor is null or p_amount_minor<=0 then raise exception 'invalid_confirmed_payment'; end if;
 if p_purchase_mode is null or p_purchase_mode not in ('full','sessions') then raise exception 'invalid_purchase_mode'; end if;
 if p_session_ids is null or cardinality(p_session_ids)=0 or cardinality(p_session_ids)>100
    or (select count(distinct x) from unnest(p_session_ids) x)<>cardinality(p_session_ids) then raise exception 'invalid_session_selection'; end if;
 select array_agg(x order by x) into chosen from unnest(p_session_ids) x;
 perform pg_advisory_xact_lock(hashtextextended(st::text||':'||p_request_id::text,0));
 select * into a from private.workshop_payment_authorizations where studio_id=st and request_id=p_request_id for update;
 if found then
  if a.offer_id<>p_offer_id or a.student_id<>p_student_id or a.session_ids is distinct from chosen
     or a.selection_mode<>p_purchase_mode or a.amount_minor<>p_amount_minor or a.method<>p_method
     or a.reference is distinct from nullif(btrim(p_reference),'') then raise exception 'idempotency_conflict'; end if;
  if a.consumed_purchase_id is null then raise exception 'authorization_not_consumed'; end if;
  return jsonb_build_object('purchase_id',a.consumed_purchase_id,'authorization_id',a.id,'replayed',true);
 end if;
 -- Only this authenticated staff review creates authorization. Students/Demi cannot self-approve.
 insert into private.workshop_payment_authorizations(studio_id,offer_id,student_id,request_id,selection_mode,session_ids,amount_minor,currency,method,reference,verified_by)
 values(st,p_offer_id,p_student_id,p_request_id,p_purchase_mode,chosen,p_amount_minor,'MXN',p_method,nullif(btrim(p_reference),''),actor) returning * into a;
 receipt:=public.workshop_checkout_confirm_v2(st,p_offer_id,p_student_id,chosen,p_purchase_mode,p_request_id,a.amount_minor,a.method,a.reference);
 update private.workshop_payment_authorizations set consumed_purchase_id=(receipt->>'purchase_id')::uuid where id=a.id;
 return receipt||jsonb_build_object('authorization_id',a.id);
end $$;

create function public.admin_confirm_workshop_payment(
 p_offer_id uuid,p_student_id uuid,p_session_ids uuid[],p_purchase_mode text,
 p_request_id uuid,p_amount_minor integer,p_method text,p_reference text,p_verified boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_confirm_workshop_payment(p_offer_id,p_student_id,p_session_ids,p_purchase_mode,p_request_id,p_amount_minor,p_method,p_reference,p_verified)
$$;

revoke all on function private.guard_workshop_payment_authorization() from public,anon,authenticated,service_role;
revoke all on function private.admin_confirm_workshop_payment(uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) from public,anon,service_role;
revoke all on function public.admin_confirm_workshop_payment(uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) from public,anon,service_role;
grant execute on function private.admin_confirm_workshop_payment(uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) to authenticated;
grant execute on function public.admin_confirm_workshop_payment(uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) to authenticated;
-- Retire the unsafe service entry points. Owner can still run synthetic SQL regression.
revoke execute on function public.workshop_checkout_confirm(uuid,uuid,uuid,uuid[],uuid,integer,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.workshop_checkout_confirm_v2(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text) from public,anon,authenticated,service_role;
