begin;
do $$ begin
 if not exists(select 1 from public.studios where id='2b338958-2f9c-4e15-8c03-cc1c959dad4a' and name like 'Demi UAT%') then
   raise exception 'Approved Sandbox UAT fixture missing: abort';
 end if;
end $$;
select set_config('request.jwt.claim.sub','7d2ba6d7-f133-46b3-832c-7c338a4b8924',true),set_config('request.jwt.claim.role','authenticated',true);
create temporary table admin_a_uat_results(name text,passed boolean,detail jsonb);
do $$
declare studio uuid:='2b338958-2f9c-4e15-8c03-cc1c959dad4a'; actor uuid:='7d2ba6d7-f133-46b3-832c-7c338a4b8924'; template uuid; session uuid; instructor uuid; other_session uuid; result jsonb; reservation uuid; student uuid; bulk jsonb; scan jsonb; pin_result jsonb; token text:='AdminAUatSandboxSynthetic';
begin
 insert into public.class_templates(studio_id,name,duration_minutes,capacity,active,credit_cost,drop_in_price_minor) values(studio,'Admin A UAT Synthetic',60,10,true,1,18000) returning id into template;
 insert into public.class_sessions(studio_id,template_id,starts_at,ends_at,capacity,status) values(studio,template,now()+interval '10 minutes',now()+interval '70 minutes',10,'scheduled') returning id into session;
 update public.studio_memberships set role='reception' where studio_id=studio and user_id=actor;
 if not private.has_capability(studio,'reservations.manage') or private.has_capability(studio,'schedule.write') then raise exception 'reception_privileges'; end if;
 insert into admin_a_uat_results values('Reception reservations without schedule editing',true,'{}');
 result:=public.admin_create_walkin(session,'AdminA','Synthetic','+525599123456','trial','pay_later');
 reservation:=(result->>'reservation_id')::uuid; student:=(result->>'student_id')::uuid;
 if not exists(select 1 from public.reservations where id=reservation and class_kind='trial' and class_amount_minor=15000 and commercial_status='payment_pending') then raise exception 'pending_walkin'; end if;
 insert into admin_a_uat_results values('Trial walk-in creates pending $150 reservation',true,'{}');
 begin perform public.set_attendance_status(reservation,'attended'); raise exception 'payment_bypass'; exception when others then if sqlerrm<>'class_payment_required' then raise; end if; end;
 insert into public.reservation_checkin_tokens(studio_id,reservation_id,token_hash) values(studio,reservation,extensions.digest(convert_to(token,'UTF8'),'sha256')) on conflict(reservation_id) do update set token_hash=excluded.token_hash;
 scan:=public.check_in_reservation(token);
 if scan->>'status'<>'payment_pending' then raise exception 'checkin_pending: %',scan; end if;
 insert into admin_a_uat_results values('Kiosk blocks pending payment without attendance',true,scan - 'student_name');
 bulk:=public.bulk_mark_attended(session);
 if (bulk->>'count')::int<>0 then raise exception 'bulk_included_pending'; end if;
 insert into admin_a_uat_results values('Bulk attendance omits pending payments',true,'{}');
 result:=public.record_class_payment_and_attendance(reservation,'efectivo','Sandbox synthetic UAT',15000);
 if result->>'status'<>'attended' or not exists(select 1 from public.payments where reservation_id=reservation and amount_minor=15000) then raise exception 'payment_not_persisted'; end if;
 insert into admin_a_uat_results values('Reception records payment then attendance before start',true,'{}');
 perform public.set_attendance_status(reservation,'reserved');
 bulk:=public.bulk_mark_attended(session);
 if (bulk->>'count')::int<>1 then raise exception 'bulk_count'; end if;
 result:=public.undo_bulk_mark_attended((bulk->>'batch_id')::uuid);
 if (result->>'count')::int<>1 then raise exception 'undo_count: %',result; end if;
 insert into admin_a_uat_results values('Bulk attendance undo restores only marked reservation',true,'{}');
 
 update public.class_sessions set status='completed' where id=session;
 begin perform public.set_attendance_status(reservation,'attended'); raise exception 'missing_reason_bypass'; exception when others then if sqlerrm<>'correction_reason_required' then raise; end if; end;
 insert into public.studio_operating_policies(studio_id,cancellation_cutoff_minutes,late_cancellation_consumes_credit,no_show_consumes_credit) values(studio,300,true,false) on conflict(studio_id) do update set no_show_consumes_credit=false;
 perform public.set_attendance_status(reservation,'no_show','Sandbox synthetic correction');
 if (select coalesce(sum(quantity),0) from public.credit_ledger where reservation_id=reservation or attendance_correction_id in (select id from public.attendance_corrections where reservation_id=reservation))<>0 then raise exception 'no_show_credit_not_returned'; end if;
 perform public.set_attendance_status(reservation,'reserved','Sandbox synthetic reset');
 if (select coalesce(sum(quantity),0) from public.credit_ledger where reservation_id=reservation or attendance_correction_id in (select id from public.attendance_corrections where reservation_id=reservation))<>-1 then raise exception 'reserved_hold_not_restored'; end if;
 insert into admin_a_uat_results values('Closed correction requires reason and restores credits according to policy',true,'{}');
 update public.class_sessions set status='scheduled' where id=session;
 bulk:=public.bulk_mark_attended(session);
 perform public.set_attendance_status(reservation,'no_show');
 result:=public.undo_bulk_mark_attended((bulk->>'batch_id')::uuid);
 if (result->>'count')::int<>0 then raise exception 'undo_overwrote_concurrent_change'; end if;
 insert into admin_a_uat_results values('Bulk undo preserves subsequent attendance changes',true,'{}');
 perform public.set_attendance_status(reservation,'reserved');
 update public.class_sessions set starts_at=now()+interval '25 minutes',ends_at=now()+interval '85 minutes' where id=session;
 begin perform public.set_attendance_status(reservation,'attended'); raise exception 'early_bypass'; exception when others then if sqlerrm<>'session_not_started' then raise; end if; end;
 insert into admin_a_uat_results values('Attendance rejected before 20 minute window',true,'{}');
 update public.studio_memberships set role='admin' where studio_id=studio and user_id=actor;
 perform public.owner_update_studio_business_profile_v1(studio,null,null,null,'Admin A UAT','Synthetic Sandbox');
 perform public.admin_save_kiosk_configuration(studio,'7391','Bienvenida al estudio');
 pin_result:=public.verify_kiosk_pin(studio,'7391');
 if not (pin_result->>'ok')::boolean then raise exception 'pin_validation'; end if;
 if exists(select 1 from private.admin_kiosk_settings where studio_id=studio and pin_hash='7391') then raise exception 'plaintext_pin'; end if;
 if private.has_capability(studio,'plan.manage') then raise exception 'admin_plan_access'; end if;
 insert into admin_a_uat_results values('Admin settings access, hashed PIN, owner-only plan',true,'{}');
 perform public.admin_cancel_session(session,'Cambio de horario de prueba');
 if not exists(select 1 from public.class_sessions where id=session and cancellation_reason='Cambio de horario de prueba' and cancelled_at is not null and cancelled_by=actor and cancellation_source='manual') then raise exception 'cancellation_audit'; end if;
 if not exists(select 1 from public.reservations where id=reservation and status='cancelled_by_studio') then raise exception 'cancellation_reservations'; end if;
 
 insert into admin_a_uat_results values('Session cancellation records reason, actor, date and releases reservation',true,'{}');
 insert into public.instructors(studio_id,person_id) select studio,person_id from public.students where id=student returning id into instructor;
 update public.studio_memberships set role='instructor',person_id=(select person_id from public.students where id=student) where studio_id=studio and user_id=actor;
 insert into public.class_sessions(studio_id,template_id,instructor_id,starts_at,ends_at,capacity,status) values(studio,template,instructor,now()+interval '10 minutes',now()+interval '70 minutes',10,'scheduled') returning id into session;
 insert into public.class_sessions(studio_id,template_id,starts_at,ends_at,capacity,status) values(studio,template,now()+interval '10 minutes',now()+interval '70 minutes',10,'scheduled') returning id into other_session;
 result:=public.admin_coach_roster_extras(session);
 begin perform public.admin_coach_roster_extras(other_session); raise exception 'coach_other_class_bypass'; exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
 begin perform public.admin_book_drop_in(session,student); raise exception 'coach_booking_bypass'; exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
 insert into admin_a_uat_results values('Coach access scoped to assigned classes and cannot book',true,'{}');

end;
$$;
select * from admin_a_uat_results;
rollback;

