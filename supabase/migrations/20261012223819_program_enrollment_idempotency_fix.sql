create or replace function public.admin_enroll_activity_program(p_program_id uuid,p_student_id uuid,p_session_id uuid,p_payment_method text,p_reference text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_program public.activity_programs%rowtype; v_product uuid; v_price integer;
 v_first date; v_session record; v_sale jsonb; v_booking jsonb; v_existing uuid;
begin
 if auth.uid() is null then raise exception 'unauthenticated'; end if;
 select * into v_program from public.activity_programs where id=p_program_id and active for update;
 if not found then raise exception 'program_not_found'; end if;
 if not private.has_capability(v_program.studio_id,'sales.write') or not private.has_capability(v_program.studio_id,'schedule.write') then raise exception 'forbidden'; end if;
 if p_request_id is null then raise exception 'request_id_required'; end if;
 select id into v_existing from public.sales where studio_id=v_program.studio_id and student_id=p_student_id and idempotency_key=p_request_id;
 if found then
  if not exists(select 1 from public.sale_lines sl join public.activity_programs pr on pr.id=p_program_id
    where sl.sale_id=v_existing and (sl.product_template_id=pr.full_product_id or exists(select 1 from public.activity_program_sessions ps where ps.program_id=pr.id and ps.single_product_id=sl.product_template_id)))
  then raise exception 'request_id_scope_mismatch'; end if;
  return jsonb_build_object('ok',true,'sale_id',v_existing,'replayed',true);
 end if;
 if not exists(select 1 from public.students where id=p_student_id and studio_id=v_program.studio_id) then raise exception 'student_not_found'; end if;
 if p_payment_method not in ('cash','transfer') or p_payment_method is null then raise exception 'invalid_payment_method'; end if;
 if p_session_id is null then v_product:=v_program.full_product_id;
 else
  if not v_program.allow_single then raise exception 'single_purchase_disabled'; end if;
  select single_product_id into v_product from public.activity_program_sessions where program_id=p_program_id and session_id=p_session_id;
  if v_product is null then raise exception 'invalid_program_session'; end if;
 end if;
 select price_minor into v_price from public.product_templates where id=v_product and active;
 if not found then raise exception 'product_not_available'; end if;
 select min((cs.starts_at at time zone s.timezone)::date) into v_first
 from public.activity_program_sessions ps join public.class_sessions cs on cs.id=ps.session_id join public.studios s on s.id=ps.studio_id
 where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id);
 -- Serialize the same seat locks used by book_student; stable order prevents deadlocks.
 perform cs.id from public.class_sessions cs join public.activity_program_sessions ps on ps.session_id=cs.id
 where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id) order by cs.id for update of cs;
 if exists(select 1 from public.activity_program_sessions ps join public.class_sessions cs on cs.id=ps.session_id
 where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id) and
 (cs.status<>'scheduled' or cs.starts_at<=now() or
  (select count(*) from public.reservations r where r.session_id=cs.id and r.status in ('reserved','attended'))>=cs.capacity))
 then raise exception 'program_session_unavailable'; end if;
 perform set_config('app.program_enrollment',p_program_id::text,true);
 v_sale:=public.create_manual_sale(p_student_id,array[v_product],v_price,p_payment_method,p_reference,'Inscripción a '||v_program.name,v_first);
 perform set_config('app.program_enrollment','',true);
 update public.sales set idempotency_key=p_request_id where id=(v_sale->>'sale_id')::uuid;
 for v_session in select ps.session_id from public.activity_program_sessions ps where ps.program_id=p_program_id and (p_session_id is null or ps.session_id=p_session_id) order by ps.session_id loop
  v_booking:=public.book_student(v_session.session_id,p_student_id);
  if not coalesce((v_booking->>'ok')::boolean,false) and not coalesce((v_booking->>'eligible')::boolean,false)
  then raise exception 'program_booking_failed:%',coalesce(v_booking->>'reason_code','unknown'); end if;
 end loop;
 return v_sale;
end;
$$;
