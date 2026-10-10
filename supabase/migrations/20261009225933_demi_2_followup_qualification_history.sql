create table public.demi_qualification_history (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 person_id uuid not null references public.persons(id),
 qualification text not null,
 qualification_reason text,
 revision integer not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create index demi_qualification_history_person on public.demi_qualification_history(studio_id,person_id,recorded_at);
alter table public.demi_qualification_history enable row level security;
revoke all on public.demi_qualification_history from public,anon,authenticated;
grant select,insert on public.demi_qualification_history to service_role;
create policy demi_qualification_history_service on public.demi_qualification_history to service_role using(true) with check(true);
create function private.record_demi_qualification_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.qualification='not_qualified' then
   insert into public.demi_qualification_history(studio_id,person_id,qualification,qualification_reason,revision)
   values(new.studio_id,new.person_id,new.qualification,new.qualification_reason,new.revision);
  end if;
 elsif (old.qualification,old.qualification_reason) is distinct from (new.qualification,new.qualification_reason) then
  insert into public.demi_qualification_history(studio_id,person_id,qualification,qualification_reason,revision)
  values(new.studio_id,new.person_id,new.qualification,new.qualification_reason,new.revision);
 end if;
 return new;
end; $$;
revoke all on function private.record_demi_qualification_history() from public,anon,authenticated,service_role;
create trigger demi_qualification_history after insert or update on public.crm_followups
for each row execute function private.record_demi_qualification_history();
insert into public.demi_qualification_history(studio_id,person_id,qualification,qualification_reason,revision)
select studio_id,person_id,qualification,qualification_reason,revision from public.crm_followups where qualification='not_qualified';

create or replace function public.service_update_demi_followup_stage(p_studio uuid,p_conversation uuid,p_stage text,p_reason text default null,p_source text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare person uuid; c public.assistant_conversations%rowtype; q text; previous_reason text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio;
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_not_found'); end if;
 select person_id into person from public.students where id=c.student_id and studio_id=p_studio;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=p_studio; end if;
 if person is null then return jsonb_build_object('ok',false,'reason_code','identity_required'); end if;
 if p_stage not in ('answering_questions','awaiting_receipt','awaiting_participant_data','not_booked','not_qualified','opt_out') then return jsonb_build_object('ok',false,'reason_code','invalid_stage'); end if;
 if p_stage='not_qualified' and length(trim(coalesce(p_reason,'')))<3 then return jsonb_build_object('ok',false,'reason_code','qualification_reason_required'); end if;
 select qualification,qualification_reason into q,previous_reason from public.crm_followups where studio_id=p_studio and person_id=person;
 q:=case when p_stage='not_qualified' then 'not_qualified' when p_stage='opt_out' then coalesce(q,'pending') else 'pending' end;
 insert into public.crm_followups(studio_id,person_id,prospect_stage,qualification,qualification_reason,revision)
 values(p_studio,person,case when p_stage in ('not_qualified','opt_out') then 'answering_questions' else p_stage end,q,case when p_stage='not_qualified' then p_reason when p_stage='opt_out' then previous_reason else null end,1)
 on conflict(studio_id,person_id) do update set prospect_stage=excluded.prospect_stage,qualification=excluded.qualification,qualification_reason=excluded.qualification_reason,revision=public.crm_followups.revision+1,updated_at=clock_timestamp();
 if p_stage in ('not_qualified','opt_out','not_booked') then
  update public.demi_followups set state='cancelled',reason_code=p_stage,lease_token=null,lease_until=null where studio_id=p_studio and person_id=person and state in ('pending','processing');
  if p_stage='opt_out' then
   insert into public.person_communication_preferences(studio_id,person_id,retention_enabled,promotions_enabled) values(p_studio,person,false,false)
   on conflict(studio_id,person_id) do update set retention_enabled=false,promotions_enabled=false,updated_at=clock_timestamp();
  end if;
 else
  perform public.service_schedule_demi_followups(p_studio,p_conversation,'prospect',coalesce(p_source,gen_random_uuid()::text),clock_timestamp());
 end if;
 return jsonb_build_object('ok',true,'stage',p_stage,'qualification',q);
end; $$;

