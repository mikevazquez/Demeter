-- A prepaid trial grants one real credit; dates are anchored to its first reservation.
create function private.attach_demi_trial_credit() returns trigger
language plpgsql security definer set search_path='' as $$
declare a uuid; d date; discipline uuid; line uuid;
begin
 if new.intent_kind<>'trial_class' then return new; end if;
 if new.status='provisional_active' and old.status is distinct from new.status and new.reservation_id is not null then
  select acquisition_id into a from public.reservations where id=new.reservation_id and studio_id=new.studio_id for update;
  if a is null then
   select (s.starts_at at time zone st.timezone)::date,t.discipline_id into d,discipline
   from public.class_sessions s join public.studios st on st.id=s.studio_id join public.class_templates t on t.id=s.template_id and t.studio_id=s.studio_id where s.id=new.session_id and s.studio_id=new.studio_id;
   select id into line from public.sale_lines where sale_id=new.sale_id and studio_id=new.studio_id and product_template_id=new.product_template_id limit 1;
   if d is null or line is null then raise exception 'trial_credit_source_missing'; end if;
   insert into public.product_acquisitions(studio_id,student_id,product_template_id,starts_on,expires_on,credit_limit,validity_days_snapshot,sale_line_id)
   values(new.studio_id,new.student_id,new.product_template_id,d,d+7,1,7,line) returning id into a;
   insert into public.product_template_disciplines(studio_id,product_template_id,discipline_id) values(new.studio_id,new.product_template_id,discipline) on conflict do nothing;
   insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,note) values(new.studio_id,a,'grant',1,'Demi trial credit: seven days from first reserved class');
   insert into public.credit_ledger(studio_id,acquisition_id,movement_type,quantity,reservation_id,note) values(new.studio_id,a,'reserve',-1,new.reservation_id,'Demi trial credit reserved');
   update public.reservations set acquisition_id=a where id=new.reservation_id and studio_id=new.studio_id;
  end if;
  new.acquisition_id:=a;
 elsif new.status='rejected' and old.status is distinct from new.status and new.acquisition_id is not null then
  update public.product_acquisitions set access_blocked=true,status='cancelled' where id=new.acquisition_id and studio_id=new.studio_id;
 end if;
 return new;
end; $$;
create trigger demi_trial_credit before update of status on public.assistant_transfer_purchase_intents for each row execute function private.attach_demi_trial_credit();
revoke all on function private.attach_demi_trial_credit() from public,anon,authenticated,service_role;

alter function private.student_enrollment_requirement_for_booking(uuid,uuid) rename to student_enrollment_requirement_for_booking_demi2_base;
create function private.student_enrollment_requirement_for_booking(p_student_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.student_enrollment_requirement_for_booking_demi2_base(p_student_id,p_session_id);
 if coalesce((result->>'missing')::boolean,false) and exists(
  select 1 from public.students st
  join public.class_sessions cs on cs.id=p_session_id and cs.studio_id=st.studio_id
  join public.studios studio on studio.id=st.studio_id
  join public.assistant_transfer_purchase_intents i on i.student_id=st.id and i.studio_id=st.studio_id and i.intent_kind='trial_class' and i.status in ('provisional_active','validated')
  join public.product_acquisitions a on a.id=i.acquisition_id and a.studio_id=st.studio_id and a.student_id=st.id
  where st.id=p_student_id and st.student_type='trial' and a.status='active' and not a.access_blocked and a.refunded_at is null
  and a.starts_on<=(cs.starts_at at time zone studio.timezone)::date and a.expires_on>=(cs.starts_at at time zone studio.timezone)::date
  and not exists(select 1 from public.reservations r where r.studio_id=st.studio_id and r.student_id=st.id and r.status='attended')
 ) then return jsonb_build_object('required',false,'missing',false,'mode','paid_trial_credit'); end if;
 return result;
end; $$;
revoke all on function private.student_enrollment_requirement_for_booking(uuid,uuid) from public,anon,authenticated,service_role;
