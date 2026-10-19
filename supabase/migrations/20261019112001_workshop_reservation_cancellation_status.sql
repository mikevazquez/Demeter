-- Use the actual reservation_status enum. Purchase/queue status remains unchanged.
create or replace function private.workshop_record_continuation(
 p_studio uuid,p_purchase uuid,p_request uuid,p_decision text,p_reason text,p_actor uuid,p_conversation uuid
) returns jsonb language plpgsql set search_path='' as $$
declare p public.workshop_purchases%rowtype; old private.workshop_continuation_decisions%rowtype;
 v_count integer:=0; v_session uuid;
begin
 if p_request is null or p_decision is null or p_decision not in ('continue','withdraw')
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'invalid_continuation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio::text||':'||p_request::text,0));
 select * into old from private.workshop_continuation_decisions where studio_id=p_studio and request_id=p_request;
 if found then
  if old.purchase_id is distinct from p_purchase or old.decision is distinct from p_decision
   or old.reason is distinct from btrim(p_reason) or old.actor_id is distinct from p_actor
   or old.conversation_id is distinct from p_conversation then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('purchase_id',p_purchase,'decision',old.decision,'released_count',old.released_count,'replayed',true);
 end if;
 select * into p from public.workshop_purchases where id=p_purchase and studio_id=p_studio for update;
 if not found then raise exception 'purchase_not_found'; end if;
 if p_decision='continue' and p.status<>'reserved' then raise exception 'purchase_not_active'; end if;
 if p_decision='withdraw' and p.status='reserved' then
  for v_session in select ps.session_id from public.workshop_purchase_sessions ps
   join public.class_sessions s on s.id=ps.session_id and s.studio_id=p_studio
   where ps.purchase_id=p.id and s.starts_at>clock_timestamp() order by ps.session_id loop
   perform 1 from public.class_sessions where id=v_session and studio_id=p_studio for update;
  end loop;
  update public.reservations r set status='cancelled_by_studio'
  from public.workshop_purchase_sessions ps,public.class_sessions s
  where ps.purchase_id=p.id and ps.reservation_id=r.id and ps.session_id=s.id
   and r.studio_id=p_studio and r.student_id=p.student_id and s.studio_id=p_studio
   and s.starts_at>clock_timestamp() and r.status::text='reserved';
  get diagnostics v_count=row_count;
  update public.workshop_purchases set status='cancelled',released_at=clock_timestamp() where id=p.id;
 end if;
 insert into private.workshop_continuation_decisions(studio_id,purchase_id,request_id,decision,reason,actor_id,conversation_id,released_count)
 values(p_studio,p.id,p_request,p_decision,btrim(p_reason),p_actor,p_conversation,v_count);
 return jsonb_build_object('purchase_id',p.id,'decision',p_decision,'released_count',v_count,'replayed',false);
end $$;

create or replace function public.service_process_workshop_overdues(p_studio uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path='' as $$
declare item record; p public.workshop_purchases%rowtype; paid bigint; session uuid; released integer; count integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.workshop_studio_policies where studio_id=p_studio and demi_enabled) then return 0; end if;
 for item in select id,sale_id from public.workshop_purchases where studio_id=p_studio and status='reserved'
  and overdue_mode='release_after_grace' and paid_minor<total_minor and balance_due_at+make_interval(mins=>grace_minutes)<p_now order by id limit 100 loop
  -- Serialize against register_sale_payment before deciding to release capacity.
  perform 1 from public.sales where id=item.sale_id and studio_id=p_studio for update;
  select * into p from public.workshop_purchases where id=item.id and studio_id=p_studio for update;
  if p.status<>'reserved' or p.overdue_mode<>'release_after_grace' or p.balance_due_at+make_interval(mins=>p.grace_minutes)>=p_now then continue; end if;
  select coalesce(sum(case when kind='refund' then -amount_minor else amount_minor end),0) into paid from public.payments where studio_id=p_studio and sale_id=p.sale_id;
  if paid>=p.total_minor then continue; end if;
  for session in select ps.session_id from public.workshop_purchase_sessions ps join public.class_sessions s on s.id=ps.session_id and s.studio_id=p_studio
   where ps.purchase_id=p.id and s.starts_at>p_now order by ps.session_id loop
   perform 1 from public.class_sessions where id=session and studio_id=p_studio for update;
  end loop;
  update public.reservations r set status='cancelled_by_studio' from public.workshop_purchase_sessions ps,public.class_sessions s
   where ps.purchase_id=p.id and ps.reservation_id=r.id and ps.session_id=s.id and r.studio_id=p_studio
    and r.student_id=p.student_id and s.studio_id=p_studio and s.starts_at>p_now and r.status::text='reserved';
  get diagnostics released=row_count;
  update public.workshop_purchases set status='released',released_at=p_now where id=p.id;
  insert into private.workshop_overdue_releases values(p.id,p_studio,p.balance_due_at,p.grace_minutes,greatest(0,p.total_minor-paid)::integer,released,p_now,clock_timestamp());
  count:=count+1;
 end loop;
 return count;
end $$;
