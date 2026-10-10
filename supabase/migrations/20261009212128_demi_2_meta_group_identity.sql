create function public.service_complete_demi_meta_group(p_studio uuid,p_conversation uuid,p_group uuid,p_participants jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.demi_group_bookings%rowtype; ac public.assistant_conversations%rowtype; person uuid; v_phone text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into ac from public.assistant_conversations where id=p_conversation and studio_id=p_studio and channel in ('facebook_messenger','instagram');
 if not found then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 select * into g from public.demi_group_bookings where id=p_group and studio_id=p_studio and conversation_id=p_conversation for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','group_not_found'); end if;
 if g.receipt_event_id is null or g.status not in ('awaiting_participants','partial','provisional','validated') then return jsonb_build_object('ok',false,'reason_code','receipt_required_before_participants'); end if;
 if jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)<>g.participant_count then return jsonb_build_object('ok',false,'reason_code','participant_count_mismatch'); end if;
 if exists(select 1 from jsonb_array_elements(p_participants) x where coalesce(x->>'phone','') !~ '^[0-9]{10}$' or length(trim(coalesce(x->>'name','')))<3) then return jsonb_build_object('ok',false,'reason_code','participant_data_required'); end if;
 if g.prospect_contact_id is not null then
  select cc.person_id into person from public.crm_contacts cc join public.assistant_channel_identities i on i.studio_id=cc.studio_id and i.crm_contact_id=cc.id and i.person_id=cc.person_id where cc.id=g.prospect_contact_id and cc.studio_id=p_studio and ac.context->>'crm_contact_id'=cc.id::text and ac.context->>'identity_id'=i.id::text and i.provider=ac.channel and ac.context->>'provider_account_id'=i.provider_account_id and ac.context->>'provider_contact_id'=i.provider_contact_id;
  if person is null or g.participant_count<>1 then return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
  v_phone:='+52'||(p_participants->0->>'phone');
  perform pg_advisory_xact_lock(hashtextextended(p_studio::text||v_phone,0));
  if exists(select 1 from public.person_contacts where studio_id=p_studio and kind='phone' and value=v_phone and person_id<>person) or exists(select 1 from public.students where studio_id=p_studio and phone=v_phone and person_id is distinct from person) then
   perform public.assistant_create_handoff(p_studio,p_conversation,ac.student_id,'technical_block','El celular escrito en Meta pertenece a otra ficha; no se vinculó ni reservó.');
   return jsonb_build_object('ok',false,'reason_code','participant_identity_requires_review');
  end if;
  if exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person and kind='phone' and value<>v_phone) then return jsonb_build_object('ok',false,'reason_code','participant_phone_mismatch'); end if;
  if not exists(select 1 from public.person_contacts where studio_id=p_studio and person_id=person and kind='phone' and value=v_phone) then insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(p_studio,person,'phone',v_phone,true); end if;
 else
  -- A typed phone cannot spend another student's credits from an unverified Meta identity.
  if exists(select 1 from jsonb_array_elements(p_participants) x join public.students st on st.studio_id=p_studio and st.phone='+52'||(x->>'phone') where st.id is distinct from ac.student_id) then
   perform public.assistant_create_handoff(p_studio,p_conversation,ac.student_id,'technical_block','Un participante de Meta usa una ficha existente que requiere verificación.');
   return jsonb_build_object('ok',false,'reason_code','participant_identity_requires_review');
  end if;
 end if;
 return public.service_complete_demi_group(p_studio,p_conversation,p_group,p_participants);
end; $$;
revoke all on function public.service_complete_demi_meta_group(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_complete_demi_meta_group(uuid,uuid,uuid,jsonb) to service_role;
