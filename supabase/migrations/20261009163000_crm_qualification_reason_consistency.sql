-- Keep prior reasons in audit history; active reasons belong to No apta only.
create or replace function public.admin_save_crm_followup(p_studio_id uuid,p_person_id uuid,p_revision integer,p_data jsonb)
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
  values(p_studio_id,p_person_id,p_data->>'prospect_stage',p_data->>'qualification',case when p_data->>'qualification'='not_qualified' then nullif(btrim(p_data->>'qualification_reason'),'') else null end,nullif(p_data->>'human_reason',''),nullif(btrim(p_data->>'human_summary'),''),coalesce(p_data->>'location',''),coalesce(p_data->>'interest',''),coalesce(p_data->>'notes',''),coalesce(p_data->>'next_action',''),nullif(p_data->>'next_action_on','')::date,p_revision+1)
  on conflict(studio_id,person_id) do update set prospect_stage=excluded.prospect_stage,qualification=excluded.qualification,qualification_reason=excluded.qualification_reason,human_reason=excluded.human_reason,human_summary=excluded.human_summary,location=excluded.location,interest=excluded.interest,notes=excluded.notes,next_action=excluded.next_action,next_action_on=excluded.next_action_on,revision=excluded.revision,updated_at=now()
  returning * into v_after;
  insert into public.crm_followup_history(studio_id,person_id,actor_id,before_data,after_data) values(p_studio_id,p_person_id,auth.uid(),case when v_before.person_id is null then null else to_jsonb(v_before) end,to_jsonb(v_after));
  return v_after.revision;
end $$;
