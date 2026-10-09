alter table public.assistant_handoffs add column if not exists assigned_to uuid references auth.users(id), add column if not exists claimed_at timestamptz, add column if not exists resolved_by uuid references auth.users(id), add column if not exists resolution_note text;
grant select on public.assistant_handoffs to authenticated;
create policy demi_handoff_staff_read on public.assistant_handoffs for select to authenticated using(private.has_capability(studio_id,'students.read'));

create function public.admin_claim_demi_handoff(p_studio uuid,p_handoff uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.assistant_handoffs%rowtype;
begin
 if auth.uid() is null or not private.has_capability(p_studio,'students.write') then raise exception 'forbidden'; end if;
 select * into h from public.assistant_handoffs where id=p_handoff and studio_id=p_studio for update;
 if not found or h.status<>'open' then return jsonb_build_object('ok',false,'reason_code','handoff_not_open'); end if;
 if h.assigned_to is not null and h.assigned_to<>auth.uid() and not private.has_capability(p_studio,'settings.write') then return jsonb_build_object('ok',false,'reason_code','handoff_already_assigned'); end if;
 update public.assistant_handoffs set assigned_to=auth.uid(),claimed_at=coalesce(claimed_at,clock_timestamp()) where id=h.id;
 update public.assistant_conversations set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('human_takeover',true,'human_takeover_handoff_id',h.id) where id=h.conversation_id and studio_id=p_studio;
 update public.demi_followups set state='cancelled',reason_code='human_control',lease_token=null,lease_until=null where conversation_id=h.conversation_id and studio_id=p_studio and state in ('pending','processing');
 return jsonb_build_object('ok',true,'status','human_control','assigned_to',auth.uid());
end; $$;

create function public.admin_resolve_demi_handoff(p_studio uuid,p_handoff uuid,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.assistant_handoffs%rowtype;
begin
 if auth.uid() is null or not private.has_capability(p_studio,'students.write') then raise exception 'forbidden'; end if;
 if length(trim(coalesce(p_note,'')))<3 then return jsonb_build_object('ok',false,'reason_code','resolution_note_required'); end if;
 select * into h from public.assistant_handoffs where id=p_handoff and studio_id=p_studio for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','handoff_not_found'); end if;
 if h.status='resolved' then return jsonb_build_object('ok',true,'idempotent',true); end if;
 if h.status<>'open' then return jsonb_build_object('ok',false,'reason_code','handoff_not_open'); end if;
 if h.assigned_to is not null and h.assigned_to<>auth.uid() and not private.has_capability(p_studio,'settings.write') then return jsonb_build_object('ok',false,'reason_code','handoff_already_assigned'); end if;
 update public.assistant_handoffs set status='resolved',resolved_at=clock_timestamp(),resolved_by=auth.uid(),resolution_note=left(trim(p_note),2000) where id=h.id;
 update public.assistant_conversations set context=context-'human_takeover'-'human_takeover_handoff_id'
 where id=h.conversation_id and studio_id=p_studio and context->>'human_takeover_handoff_id'=h.id::text;
 return jsonb_build_object('ok',true,'status','resolved','automatic_control_returned',not exists(select 1 from public.assistant_handoffs where studio_id=p_studio and conversation_id=h.conversation_id and status='open'));
end; $$;
revoke all on function public.admin_claim_demi_handoff(uuid,uuid),public.admin_resolve_demi_handoff(uuid,uuid,text) from public,anon;
grant execute on function public.admin_claim_demi_handoff(uuid,uuid),public.admin_resolve_demi_handoff(uuid,uuid,text) to authenticated;
