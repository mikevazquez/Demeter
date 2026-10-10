-- Additive CRM metadata. Financial and attendance records remain authoritative.
create table public.crm_followups (
  studio_id uuid not null references public.studios(id),
  person_id uuid not null references public.persons(id),
  prospect_stage text not null default 'answering_questions' check (prospect_stage in ('answering_questions','awaiting_receipt','awaiting_participant_data','not_booked')),
  qualification text not null default 'pending' check (qualification in ('pending','qualified','not_qualified')),
  qualification_reason text,
  human_reason text check (human_reason in ('refund','policy_exception','complaint','sensitive_topic','requested','persistent_error')),
  human_summary text,
  location text not null default '', interest text not null default '',
  notes text not null default '', next_action text not null default '', next_action_on date,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(studio_id,person_id),
  check (qualification <> 'not_qualified' or coalesce(length(btrim(qualification_reason)),0) > 0),
  check (human_reason is null or coalesce(length(btrim(human_summary)),0) > 0)
);
create table public.crm_followup_history (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
  person_id uuid not null references public.persons(id), actor_id uuid not null references auth.users(id),
  before_data jsonb, after_data jsonb not null, created_at timestamptz not null default now()
);
create index crm_followup_history_person on public.crm_followup_history(studio_id,person_id,created_at desc);
alter table public.crm_followups enable row level security;
alter table public.crm_followup_history enable row level security;
create policy crm_followups_read on public.crm_followups for select to authenticated using (private.has_capability(studio_id,'students.read'));
create policy crm_followup_history_read on public.crm_followup_history for select to authenticated using (private.has_capability(studio_id,'students.read'));
revoke all on public.crm_followups,public.crm_followup_history from public,anon,authenticated;
grant select on public.crm_followups,public.crm_followup_history to authenticated;
create function public.admin_save_crm_followup(p_studio_id uuid,p_person_id uuid,p_revision integer,p_data jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_before public.crm_followups; v_after public.crm_followups;
begin
  if auth.uid() is null or not private.has_capability(p_studio_id,'students.write') then raise exception 'crm_forbidden'; end if;
  if not exists (select 1 from public.persons p where p.id=p_person_id and p.studio_id=p_studio_id)
    or not (exists(select 1 from public.students s where s.person_id=p_person_id and s.studio_id=p_studio_id and s.archived_at is null)
    or exists(select 1 from public.crm_contacts c where c.person_id=p_person_id and c.studio_id=p_studio_id)) then raise exception 'crm_person_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_studio_id::text||p_person_id::text,0));
  select * into v_before from public.crm_followups where studio_id=p_studio_id and person_id=p_person_id for update;
  if coalesce(v_before.revision,0) <> p_revision then raise exception 'crm_revision_conflict'; end if;
  if length(p_data::text)>16000 then raise exception 'crm_data_too_large'; end if;
  if p_data->>'prospect_stage'='not_booked' and v_before.prospect_stage='awaiting_participant_data' then raise exception 'crm_incomplete_data_must_keep_stage'; end if;
  insert into public.crm_followups(studio_id,person_id,prospect_stage,qualification,qualification_reason,human_reason,human_summary,location,interest,notes,next_action,next_action_on,revision)
  values(p_studio_id,p_person_id,p_data->>'prospect_stage',p_data->>'qualification',nullif(btrim(p_data->>'qualification_reason'),''),nullif(p_data->>'human_reason',''),nullif(btrim(p_data->>'human_summary'),''),coalesce(p_data->>'location',''),coalesce(p_data->>'interest',''),coalesce(p_data->>'notes',''),coalesce(p_data->>'next_action',''),nullif(p_data->>'next_action_on','')::date,p_revision+1)
  on conflict(studio_id,person_id) do update set prospect_stage=excluded.prospect_stage,qualification=excluded.qualification,qualification_reason=excluded.qualification_reason,human_reason=excluded.human_reason,human_summary=excluded.human_summary,location=excluded.location,interest=excluded.interest,notes=excluded.notes,next_action=excluded.next_action,next_action_on=excluded.next_action_on,revision=excluded.revision,updated_at=now()
  returning * into v_after;
  insert into public.crm_followup_history(studio_id,person_id,actor_id,before_data,after_data) values(p_studio_id,p_person_id,auth.uid(),case when v_before.person_id is null then null else to_jsonb(v_before) end,to_jsonb(v_after));
  return v_after.revision;
end $$;
revoke all on function public.admin_save_crm_followup(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.admin_save_crm_followup(uuid,uuid,integer,jsonb) to authenticated;

-- CRM staff may read conversations, never write turns or send outbound messages.
create policy assistant_conversations_crm_read on public.assistant_conversations for select to authenticated using (private.has_capability(studio_id,'students.read'));
create policy assistant_turns_crm_read on public.assistant_turns for select to authenticated using (private.has_capability(studio_id,'students.read'));
grant select on public.assistant_enrollment_intents to authenticated;
create policy assistant_enrollment_intents_crm_read on public.assistant_enrollment_intents for select to authenticated using (private.has_capability(studio_id,'students.read') and private.has_capability(studio_id,'sales.read'));

