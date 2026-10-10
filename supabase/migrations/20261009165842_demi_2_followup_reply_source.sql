-- Schedule from a persisted assistant reply, independent of whether the model calls a CRM tool.
create function private.seed_demi_followups_on_assistant_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.assistant_conversations%rowtype; person uuid; st public.students%rowtype; followup_kind text;
begin
 if new.role<>'assistant' or auth.role() is distinct from 'service_role' then return new; end if;
 select * into c from public.assistant_conversations where id=new.conversation_id and studio_id=new.studio_id;
 if not found or c.status<>'open' or c.channel<>'whatsapp' then return new; end if;
 select * into st from public.students where id=c.student_id and studio_id=c.studio_id;
 person:=st.person_id;
 if person is null then select person_id into person from public.crm_contacts where id=nullif(c.context->>'crm_contact_id','')::uuid and studio_id=c.studio_id; end if;
 if person is null or (st.id is not null and st.student_type<>'trial') then return new; end if;
 if exists(select 1 from public.person_communication_preferences where studio_id=c.studio_id and person_id=person and (whatsapp_blocked or not retention_enabled or not promotions_enabled))
 or exists(select 1 from public.crm_followups where studio_id=c.studio_id and person_id=person and qualification='not_qualified')
 or exists(select 1 from public.reservations where studio_id=c.studio_id and student_id=st.id and status='reserved')
 or exists(select 1 from public.assistant_handoffs where studio_id=c.studio_id and conversation_id=c.id and status='open') then return new; end if;
 followup_kind:=case when st.trial_status='attended' then 'post_trial' else 'prospect' end;
 -- A new answer starts a new chain; supersede previous pending sources without resending them.
 update public.demi_followups set state='cancelled',reason_code='newer_assistant_reply',lease_token=null,lease_until=null
 where studio_id=c.studio_id and person_id=person and kind in ('prospect','post_trial') and state in ('pending','processing');
 perform public.service_schedule_demi_followups(c.studio_id,c.id,followup_kind,new.id::text,new.created_at);
 return new;
end; $$;
create trigger demi_followups_assistant_reply after insert on public.assistant_turns for each row execute function private.seed_demi_followups_on_assistant_reply();
revoke all on function private.seed_demi_followups_on_assistant_reply() from public,anon,authenticated,service_role;
