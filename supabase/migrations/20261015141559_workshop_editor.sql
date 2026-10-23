-- LOCAL/PENDING: workshop authoring, optimistic edits, and owned Agenda sessions.
alter table public.workshop_offers add column revision integer not null default 1 check(revision>0);
alter table public.class_templates add column workshop_offer_id uuid references public.workshop_offers(id) on delete restrict;
create index class_templates_workshop_offer_idx on public.class_templates(workshop_offer_id) where workshop_offer_id is not null;

create table private.workshop_editor_requests (
 studio_id uuid not null references public.studios(id), request_id uuid not null,
 offer_id uuid not null references public.workshop_offers(id),
 payload jsonb not null, input_offer_id uuid, expected_revision integer, saved_revision integer not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(studio_id,request_id)
);
create index workshop_editor_requests_offer_idx on private.workshop_editor_requests(offer_id);
alter table private.workshop_editor_requests enable row level security;
revoke all on private.workshop_editor_requests from public,anon,authenticated,service_role;

create function private.workshop_editor_allowed(p_studio_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
 and coalesce(private.has_capability(p_studio_id,'products.write'),false)
 and exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
 and exists(select 1 from public.studios where id=p_studio_id and status='active')
$$;

create function private.workshop_edit_locked(p_offer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workshop_purchases where offer_id=p_offer_id)
 or exists(select 1 from public.workshop_payment_authorizations where offer_id=p_offer_id)
 or exists(select 1 from private.workshop_payment_authorizations where offer_id=p_offer_id)
 or exists(select 1 from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
   left join public.class_templates t on t.id=s.template_id
   where os.offer_id=p_offer_id and (s.starts_at<=now() or s.status::text<>'scheduled'
     or t.workshop_offer_id is distinct from p_offer_id
     or exists(select 1 from public.reservations r where r.session_id=s.id)))
$$;

create function private.admin_workshop_editor_context(p_studio_id uuid,p_offer_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_offer public.workshop_offers%rowtype; v_tz text; v_draft jsonb; v_policy record;
begin
 if not private.workshop_editor_allowed(p_studio_id) then raise exception 'forbidden'; end if;
 select timezone into v_tz from public.studios where id=p_studio_id;
 select * into v_policy from public.workshop_studio_policies where studio_id=p_studio_id;
 if p_offer_id is not null then
   select * into v_offer from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id;
   if not found then raise exception 'offer_not_found'; end if;
   v_draft:=jsonb_build_object('title',v_offer.title,'fullPriceMinor',v_offer.full_price_minor,
     'allowIndividualSessions',v_offer.allow_individual_sessions,'requiresEnrollment',v_offer.requires_enrollment,
     'depositMode',v_offer.deposit_mode,'depositValue',v_offer.deposit_value,
     'balanceDueLocal',case when v_offer.balance_due_at is null then '' else to_char(v_offer.balance_due_at at time zone v_tz,'YYYY-MM-DD"T"HH24:MI') end,
     'overdueMode',v_offer.overdue_mode,'graceMinutes',v_offer.grace_minutes,
     'dates',coalesce((select jsonb_agg(jsonb_build_object('sessionId',s.id,
       'date',to_char(s.starts_at at time zone v_tz,'YYYY-MM-DD'),'time',to_char(s.starts_at at time zone v_tz,'HH24:MI'),
       'disciplineId',t.discipline_id,'instructorId',coalesce(s.instructor_id::text,''),
       'spaceId',coalesce(s.space_id::text,''),'durationMinutes',extract(epoch from s.ends_at-s.starts_at)/60,
       'capacity',s.capacity,'priceMinor',os.individual_price_minor) order by s.starts_at,s.id)
       from public.workshop_offer_sessions os join public.class_sessions s on s.id=os.session_id
       join public.class_templates t on t.id=s.template_id where os.offer_id=p_offer_id),'[]'::jsonb));
 end if;
 return jsonb_build_object('draft',v_draft,'revision',v_offer.revision,
   'locked',case when p_offer_id is null then false else private.workshop_edit_locked(p_offer_id) end,
   'timeZone',v_tz,'currency',(select currency from public.studios where id=p_studio_id),
   'studioPolicy',jsonb_build_object('requiresEnrollment',coalesce(v_policy.requires_enrollment,false),
     'overdueMode',coalesce(v_policy.overdue_mode,'keep_and_notify'),'graceMinutes',coalesce(v_policy.grace_minutes,0)),
   'disciplines',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
     from public.disciplines where studio_id=p_studio_id and active),'[]'::jsonb),
   'instructors',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',btrim(concat(p.first_name,' ',p.last_name))) order by p.first_name,i.id)
     from public.instructors i join public.persons p on p.id=i.person_id and p.studio_id=i.studio_id
     where i.studio_id=p_studio_id and i.status='active'),'[]'::jsonb),
   'spaces',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'capacity',capacity) order by name,id)
     from public.spaces where studio_id=p_studio_id and active),'[]'::jsonb));
end $$;

create function public.admin_workshop_editor_context(p_studio_id uuid,p_offer_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_workshop_editor_context(p_studio_id,p_offer_id)
$$;

create function private.admin_save_workshop(p_studio_id uuid,p_offer_id uuid,p_request_id uuid,p_expected_revision integer,p_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_offer public.workshop_offers%rowtype; v_request private.workshop_editor_requests%rowtype;
 v_id uuid; v_tz text; v_title text; v_price integer; v_allow boolean; v_deposit text; v_value numeric;
 v_enrollment boolean; v_overdue text; v_grace integer; v_due timestamptz;
 v_row jsonb; v_old_ids uuid[]; v_seen_ids uuid[]:='{}'; v_planned jsonb:='[]';
 v_session uuid; v_template uuid; v_discipline uuid; v_instructor uuid; v_space uuid;
 v_start timestamptz; v_end timestamptz; v_duration integer; v_capacity integer; v_single integer;
 v_revision integer; v_locked boolean;
begin
 if not private.workshop_editor_allowed(p_studio_id) then raise exception 'forbidden'; end if;
 if p_request_id is null or jsonb_typeof(p_draft) is distinct from 'object' then raise exception 'invalid_workshop'; end if;
 v_title:=btrim(p_draft->>'title');
 if v_title is null or length(v_title) not between 1 and 80 then raise exception 'invalid_workshop_title'; end if;
 -- Serialize this editor's schedule writes; checkout serializes on the offer/session locks below.
 perform pg_advisory_xact_lock(hashtextextended('workshop-editor:'||p_studio_id::text,0));
 select * into v_request from private.workshop_editor_requests where studio_id=p_studio_id and request_id=p_request_id;
 if found then
   if v_request.payload is distinct from p_draft or v_request.expected_revision is distinct from p_expected_revision
      or v_request.input_offer_id is distinct from p_offer_id then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('offer_id',v_request.offer_id,'revision',v_request.saved_revision,'replayed',true);
 end if;
 if p_offer_id is not null then
   select * into v_offer from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id for update;
   if not found then raise exception 'offer_not_found'; end if;
   if p_expected_revision is distinct from v_offer.revision then raise exception 'workshop_revision_conflict'; end if;
   perform s.id from public.class_sessions s join public.workshop_offer_sessions os on os.session_id=s.id
   where os.offer_id=p_offer_id order by s.id for update of s;
   v_id:=p_offer_id; v_locked:=private.workshop_edit_locked(p_offer_id);
 else
   if p_expected_revision is not null then raise exception 'invalid_workshop_revision'; end if;
   v_locked:=false;
 end if;
 if v_locked then
   if (p_draft-'title')<>'{}'::jsonb then raise exception 'workshop_edit_locked'; end if;
   update public.workshop_offers set title=v_title,revision=revision+1 where id=v_id returning revision into v_revision;
   update public.class_templates set name=v_title where workshop_offer_id=v_id;
 else
   select timezone into v_tz from public.studios where id=p_studio_id;
   if jsonb_typeof(p_draft->'dates') is distinct from 'array' then raise exception 'invalid_workshop_dates'; end if;
   if jsonb_array_length(p_draft->'dates') not between 1 and 100 then raise exception 'invalid_workshop_dates'; end if;
   v_price:=(p_draft->>'fullPriceMinor')::integer;
   v_allow:=(p_draft->>'allowIndividualSessions')::boolean;
   v_enrollment:=(p_draft->>'requiresEnrollment')::boolean;
   v_deposit:=p_draft->>'depositMode'; v_value:=(p_draft->>'depositValue')::numeric;
   v_overdue:=p_draft->>'overdueMode'; v_grace:=(p_draft->>'graceMinutes')::integer;
   if v_price is null or v_price<=0 or v_allow is null or v_deposit is null
      or v_deposit not in ('full','fixed','percent') or
      (v_deposit='full' and v_value is not null) or
      (v_deposit='fixed' and (v_value is null or v_value<=0 or v_value<>trunc(v_value) or v_value>v_price)) or
      (v_deposit='percent' and (v_value is null or v_value<=0 or v_value>100 or v_value<>round(v_value,2))) or
      (v_overdue is not null and v_overdue not in ('keep_and_notify','release_after_grace')) or
      (v_grace is not null and v_grace not between 0 and 525600) or
      (v_overdue='release_after_grace' and v_grace is null) then raise exception 'invalid_workshop_policy'; end if;
   v_due:=case when nullif(p_draft->>'balanceDueLocal','') is null then null
     else (p_draft->>'balanceDueLocal')::timestamp at time zone v_tz end;
   if v_due is not null and v_due<=now() then raise exception 'invalid_balance_due_date'; end if;
   if v_deposit<>'full' and v_due is null then raise exception 'balance_due_date_required'; end if;
   if exists(select 1 from jsonb_array_elements(p_draft->'dates') group by value->>'date',value->>'time' having count(*)>1) then
     raise exception 'duplicate_workshop_date'; end if;
   if p_offer_id is null then
     insert into public.workshop_offers(studio_id,title,full_price_minor,allow_individual_sessions,requires_enrollment,
       deposit_mode,deposit_value,balance_due_at,overdue_mode,grace_minutes)
     values(p_studio_id,v_title,v_price,v_allow,v_enrollment,v_deposit,v_value,v_due,v_overdue,v_grace)
     returning id,revision into v_id,v_revision;
   else
     update public.workshop_offers set title=v_title,full_price_minor=v_price,allow_individual_sessions=v_allow,
       requires_enrollment=v_enrollment,deposit_mode=v_deposit,deposit_value=v_value,balance_due_at=v_due,
       overdue_mode=v_overdue,grace_minutes=v_grace,revision=revision+1 where id=v_id returning revision into v_revision;
   end if;
   select coalesce(array_agg(session_id),'{}') into v_old_ids from public.workshop_offer_sessions where offer_id=v_id;
   for v_row in select value from jsonb_array_elements(p_draft->'dates') order by value->>'date',value->>'time' loop
     v_session:=nullif(v_row->>'sessionId','')::uuid;
     if v_session is not null and (not v_session=any(v_old_ids) or v_session=any(v_seen_ids)) then raise exception 'invalid_workshop_session'; end if;
     v_discipline:=nullif(v_row->>'disciplineId','')::uuid; v_instructor:=nullif(v_row->>'instructorId','')::uuid;
     v_space:=nullif(v_row->>'spaceId','')::uuid; v_duration:=(v_row->>'durationMinutes')::integer;
     v_capacity:=(v_row->>'capacity')::integer; v_single:=(v_row->>'priceMinor')::integer;
     if not exists(select 1 from public.disciplines where id=v_discipline and studio_id=p_studio_id and active) then raise exception 'invalid_discipline'; end if;
     if v_duration is null or v_duration not between 15 and 360 or v_capacity is null or v_capacity not between 1 and 10000
        or coalesce(v_row->>'time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or coalesce(v_row->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or (v_allow and (v_single is null or v_single<=0)) or (v_single is not null and v_single<0) then raise exception 'invalid_workshop_date'; end if;
     if v_instructor is not null and not exists(select 1 from public.instructors where id=v_instructor and studio_id=p_studio_id and status='active') then raise exception 'invalid_instructor'; end if;
     if v_space is not null and not exists(select 1 from public.spaces where id=v_space and studio_id=p_studio_id and active and (capacity is null or capacity>=v_capacity)) then raise exception 'invalid_space'; end if;
     v_start:=((v_row->>'date')||' '||(v_row->>'time'))::timestamp at time zone v_tz;
     if v_start<=now() or to_char(v_start at time zone v_tz,'YYYY-MM-DD"T"HH24:MI')<>(v_row->>'date')||'T'||(v_row->>'time') then raise exception 'invalid_workshop_date'; end if;
     v_end:=v_start+make_interval(mins=>v_duration);
     if exists(select 1 from public.class_sessions s where s.studio_id=p_studio_id and s.status::text<>'cancelled'
       and not s.id=any(v_old_ids) and s.starts_at<v_end and s.ends_at>v_start
       and ((v_instructor is not null and s.instructor_id=v_instructor) or (v_space is not null and s.space_id=v_space)))
       or exists(select 1 from jsonb_array_elements(v_planned) x where (x->>'start')::timestamptz<v_end and (x->>'end')::timestamptz>v_start
       and ((v_instructor is not null and x->>'instructor'=v_instructor::text) or (v_space is not null and x->>'space'=v_space::text))) then raise exception 'session_conflict'; end if;
     v_planned:=v_planned||jsonb_build_array(jsonb_build_object('start',v_start,'end',v_end,'instructor',v_instructor,'space',v_space));
     if v_session is null then
       -- Inactive templates are dedicated to fixed dates, not recurring/regular sales.
       insert into public.class_templates(studio_id,discipline_id,name,duration_minutes,capacity,active,workshop_offer_id)
       values(p_studio_id,v_discipline,v_title,v_duration,v_capacity,false,v_id) returning id into v_template;
       insert into public.class_sessions(studio_id,template_id,instructor_id,space_id,starts_at,ends_at,capacity,assistant_visible)
       values(p_studio_id,v_template,v_instructor,v_space,v_start,v_end,v_capacity,false) returning id into v_session;
       insert into public.workshop_offer_sessions(offer_id,session_id,individual_price_minor) values(v_id,v_session,case when v_allow then v_single else null end);
     else
       select template_id into v_template from public.class_sessions where id=v_session;
       update public.class_templates set discipline_id=v_discipline,name=v_title,duration_minutes=v_duration,capacity=v_capacity where id=v_template;
       update public.class_sessions set instructor_id=v_instructor,space_id=v_space,starts_at=v_start,ends_at=v_end,capacity=v_capacity where id=v_session;
       update public.workshop_offer_sessions set individual_price_minor=case when v_allow then v_single else null end where offer_id=v_id and session_id=v_session;
     end if;
     v_seen_ids:=array_append(v_seen_ids,v_session);
   end loop;
   -- Retired dates remain in Agenda/history as cancelled, never deleted/reassigned.
   update public.class_sessions set status='cancelled' where id=any(v_old_ids) and not id=any(v_seen_ids);
   delete from public.workshop_offer_sessions where offer_id=v_id and not session_id=any(v_seen_ids);
 end if;
 insert into private.workshop_editor_requests(studio_id,request_id,offer_id,payload,input_offer_id,expected_revision,saved_revision,created_by)
 values(p_studio_id,p_request_id,v_id,p_draft,p_offer_id,p_expected_revision,v_revision,auth.uid());
 return jsonb_build_object('offer_id',v_id,'revision',v_revision,'replayed',false);
end $$;

create function public.admin_save_workshop(p_studio_id uuid,p_offer_id uuid,p_request_id uuid,p_expected_revision integer,p_draft jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_save_workshop(p_studio_id,p_offer_id,p_request_id,p_expected_revision,p_draft)
$$;

-- Preserve legacy programs' existing entitlement rules and exclude configurable
-- workshop dates/templates from regular package access (including retired dates).
create or replace function private.program_product_allows_session(p_product_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select ct.workshop_offer_id is null
 and not exists(select 1 from public.workshop_offer_sessions os where os.session_id=cs.id)
 and (ct.program_id is null or exists(
   select 1 from public.activity_programs p join public.activity_program_sessions ps on ps.program_id=p.id
   where p.id=ct.program_id and p.studio_id=ct.studio_id and ps.session_id=cs.id
   and (p.full_product_id=p_product_id or ps.single_product_id=p_product_id)))
 from public.class_sessions cs join public.class_templates ct on ct.id=cs.template_id where cs.id=p_session_id;
$$;

create function private.guard_configurable_workshop_session()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_owned boolean; v_held boolean;
begin
 select exists(select 1 from public.class_templates where id=old.template_id and workshop_offer_id is not null)
   or exists(select 1 from public.workshop_offer_sessions where session_id=old.id) into v_owned;
 if not v_owned then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='DELETE' then raise exception 'workshop_session_delete_forbidden'; end if;
 select exists(select 1 from public.reservations where session_id=old.id)
 or exists(select 1 from public.workshop_offer_sessions os where os.session_id=old.id and
   (exists(select 1 from public.workshop_purchases p where p.offer_id=os.offer_id)
    or exists(select 1 from public.workshop_payment_authorizations a where a.offer_id=os.offer_id)
    or exists(select 1 from private.workshop_payment_authorizations a where a.offer_id=os.offer_id))) into v_held;
 if v_held and ((new.starts_at,new.ends_at,new.capacity,new.instructor_id,new.space_id,new.template_id,new.studio_id)
    is distinct from (old.starts_at,old.ends_at,old.capacity,old.instructor_id,old.space_id,old.template_id,old.studio_id)
    or (new.status::text='cancelled' and old.status::text<>'cancelled')) then raise exception 'workshop_edit_locked'; end if;
 return new;
end $$;
create trigger guard_configurable_workshop_session before update or delete on public.class_sessions
for each row execute function private.guard_configurable_workshop_session();

-- Price edits must not turn a formerly full payment into an unexpected balance.
create function private.admin_workshop_context_revision(p_studio_id uuid,p_offer_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_revision integer;
begin
 result:=private.admin_workshop_context(p_studio_id,p_offer_id);
 if p_offer_id is not null then
   -- Authorize first, then hold a shared lock while reading both prices and revision.
   select revision into v_revision from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id for share;
   result:=private.admin_workshop_context(p_studio_id,p_offer_id);
   result:=jsonb_set(result,'{offer,revision}',to_jsonb(v_revision));
 end if;
 return result;
end $$;
create or replace function public.admin_workshop_context(p_studio_id uuid,p_offer_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_workshop_context_revision(p_studio_id,p_offer_id)
$$;
create function private.admin_purchase_workshop_checked(
 p_studio_id uuid,p_offer_id uuid,p_student_id uuid,p_session_ids uuid[],p_purchase_mode text,
 p_request_id uuid,p_received_amount_minor integer,p_payment_method text,p_reference text,p_received boolean,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 if auth.uid() is null or not coalesce(private.has_capability(p_studio_id,'sales.write'),false)
   or not coalesce(private.has_capability(p_studio_id,'schedule.write'),false)
   or not exists(select 1 from public.user_accounts where id=auth.uid() and status='active')
   or not exists(select 1 from public.studios where id=p_studio_id and status='active') then raise exception 'forbidden'; end if;
 select revision into v_revision from public.workshop_offers where id=p_offer_id and studio_id=p_studio_id for share;
 if not found then raise exception 'offer_not_found'; end if;
 if not exists(select 1 from public.workshop_payment_authorizations where studio_id=p_studio_id
   and offer_id=p_offer_id and idempotency_key=p_request_id and consumed_purchase_id is not null)
   and p_expected_revision is distinct from v_revision then raise exception 'workshop_revision_conflict'; end if;
 return private.admin_purchase_workshop(p_studio_id,p_offer_id,p_student_id,p_session_ids,p_purchase_mode,
   p_request_id,p_received_amount_minor,p_payment_method,p_reference,p_received);
end $$;
create function public.admin_purchase_workshop_checked(
 p_studio_id uuid,p_offer_id uuid,p_student_id uuid,p_session_ids uuid[],p_purchase_mode text,
 p_request_id uuid,p_received_amount_minor integer,p_payment_method text,p_reference text,p_received boolean,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_purchase_workshop_checked(p_studio_id,p_offer_id,p_student_id,p_session_ids,p_purchase_mode,
   p_request_id,p_received_amount_minor,p_payment_method,p_reference,p_received,p_expected_revision)
$$;

revoke all on function private.workshop_editor_allowed(uuid) from public,anon,authenticated,service_role;
revoke all on function private.workshop_edit_locked(uuid) from public,anon,authenticated,service_role;
revoke all on function private.guard_configurable_workshop_session() from public,anon,authenticated,service_role;
revoke all on function private.program_product_allows_session(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_workshop_editor_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_workshop_editor_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_save_workshop(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_save_workshop(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_workshop_editor_context(uuid,uuid) to authenticated;
grant execute on function public.admin_workshop_editor_context(uuid,uuid) to authenticated;
grant execute on function private.admin_save_workshop(uuid,uuid,uuid,integer,jsonb) to authenticated;
grant execute on function public.admin_save_workshop(uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on function private.admin_workshop_context_revision(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_workshop_context_revision(uuid,uuid) to authenticated;
revoke all on function private.admin_purchase_workshop_checked(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean,integer) from public,anon,authenticated,service_role;
revoke all on function public.admin_purchase_workshop_checked(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function private.admin_purchase_workshop_checked(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean,integer) to authenticated;
grant execute on function public.admin_purchase_workshop_checked(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean,integer) to authenticated;
-- Keep every client-facing purchase path behind the revision check.
revoke all on function private.admin_purchase_workshop(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_purchase_workshop(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_authorize_workshop_payment(uuid,uuid,uuid,uuid[],text,uuid,integer,text,text,text,boolean) from public,anon,authenticated,service_role;
