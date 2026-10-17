create or replace function public.workshop_checkout_preflight(p_studio_id uuid,p_offer_id uuid,p_student_id uuid,p_session_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_offer record; v_student uuid; v_expected int; v_selected int; v_capacity int; v_taken int; v_session uuid; v_total bigint;
begin
 if p_session_ids is null or cardinality(p_session_ids)=0 or cardinality(p_session_ids)>100 then raise exception 'invalid_session_selection'; end if;
 if (select count(distinct x) from unnest(p_session_ids) x) <> cardinality(p_session_ids) then raise exception 'duplicate_session'; end if;
 select * into v_offer from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id;
 if not found then raise exception 'offer_not_found'; end if;
 select id into v_student from public.students where id=p_student_id and studio_id=p_studio_id;
 if v_student is null then raise exception 'student_not_found'; end if;
 select count(*) into v_expected from public.workshop_offer_sessions where offer_id=p_offer_id;
 select count(*) into v_selected from public.workshop_offer_sessions where offer_id=p_offer_id and session_id=any(p_session_ids);
 if v_selected<>cardinality(p_session_ids) then raise exception 'session_not_in_offer'; end if;
 if cardinality(p_session_ids)<>v_expected and not v_offer.allow_individual_sessions then raise exception 'individual_sessions_disabled'; end if;
 if cardinality(p_session_ids)=v_expected then v_total:=v_offer.full_price_minor;
 else
   select sum(individual_price_minor)::bigint into v_total from public.workshop_offer_sessions where offer_id=p_offer_id and session_id=any(p_session_ids);
   if v_total is null or exists(select 1 from public.workshop_offer_sessions where offer_id=p_offer_id and session_id=any(p_session_ids) and individual_price_minor is null) then raise exception 'individual_price_missing'; end if;
 end if;
 for v_session in select unnest(p_session_ids) order by 1 loop
   select capacity into v_capacity from public.class_sessions where id=v_session and studio_id=p_studio_id and status::text='scheduled' for update;
   if v_capacity is null then raise exception 'session_unavailable'; end if;
   select count(*) into v_taken from public.reservations where session_id=v_session and studio_id=p_studio_id and status::text in ('reserved','attended');
   if v_taken>=v_capacity then raise exception 'session_full'; end if;
 end loop;
 return jsonb_build_object('studio_id',p_studio_id,'offer_id',p_offer_id,'student_id',p_student_id,'total_minor',v_total,'session_count',cardinality(p_session_ids),'can_reserve',true);
end $$;
revoke all on function public.workshop_checkout_preflight(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workshop_checkout_preflight(uuid,uuid,uuid,uuid[]) to service_role;
