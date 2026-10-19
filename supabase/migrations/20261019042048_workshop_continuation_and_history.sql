-- Audited continuity decisions preserve the original purchase and payment ledger.
create table private.workshop_continuation_decisions (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 purchase_id uuid not null references public.workshop_purchases(id), request_id uuid not null,
 decision text not null check(decision in ('continue','withdraw')), reason text not null,
 actor_id uuid references auth.users(id), conversation_id uuid references public.assistant_conversations(id),
 released_count integer not null default 0, created_at timestamptz not null default clock_timestamp(),
 unique(studio_id,request_id)
);
alter table private.workshop_continuation_decisions enable row level security;
revoke all on private.workshop_continuation_decisions from public,anon,authenticated,service_role;

create function private.workshop_record_continuation(
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
  update public.reservations r set status='cancelled'
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
revoke all on function private.workshop_record_continuation(uuid,uuid,uuid,text,text,uuid,uuid)
 from public,anon,authenticated,service_role;

create function public.admin_record_workshop_continuation(
 p_studio_id uuid,p_purchase_id uuid,p_request_id uuid,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'students.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
 or not coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
 or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active') then raise exception 'forbidden'; end if;
 return private.workshop_record_continuation(p_studio_id,p_purchase_id,p_request_id,p_decision,p_reason,auth.uid(),null);
end $$;
revoke all on function public.admin_record_workshop_continuation(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_workshop_continuation(uuid,uuid,uuid,text,text) to authenticated;

create function public.admin_student_workshops(p_studio_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
 or not coalesce(private.has_capability(p_studio_id,'students.read'),false)
 or not coalesce(private.has_capability(p_studio_id,'sales.read'),false)
 or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
 or not exists(select 1 from public.studios where id=p_studio_id and status='active') then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.students where id=p_student_id and studio_id=p_studio_id) then raise exception 'student_not_found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'offerId',p.offer_id,'title',o.title,'saleId',p.sale_id,'selectionMode',p.selection_mode,
  'totalMinor',p.total_minor,'paidMinor',p.paid_minor,'balanceMinor',greatest(0,p.total_minor-p.paid_minor),
  'dueAt',p.balance_due_at,'status',p.status,'createdAt',p.created_at,
  'continuation',(select d.decision from private.workshop_continuation_decisions d where d.purchase_id=p.id and d.studio_id=p_studio_id order by d.created_at desc,d.id desc limit 1),
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'startsAt',s.starts_at,'status',r.status) order by s.starts_at,s.id),'[]'::jsonb)
   from public.workshop_purchase_sessions ps join public.class_sessions s on s.id=ps.session_id and s.studio_id=p_studio_id
   left join public.reservations r on r.id=ps.reservation_id and r.studio_id=p_studio_id and r.student_id=p_student_id
   where ps.purchase_id=p.id)) order by p.created_at desc,p.id),'[]'::jsonb) into result
 from public.workshop_purchases p join public.workshop_offers o on o.id=p.offer_id and o.studio_id=p.studio_id
 where p.studio_id=p_studio_id and p.student_id=p_student_id;
 return result;
end $$;
revoke all on function public.admin_student_workshops(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_student_workshops(uuid,uuid) to authenticated;
