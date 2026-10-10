create or replace function public.service_identify_demi_meta_contact(p_studio uuid,p_conversation uuid,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.assistant_conversations%rowtype; i public.assistant_channel_identities%rowtype;
 digits text; v_phone text; candidates jsonb; h jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into c from public.assistant_conversations where id=p_conversation and studio_id=p_studio and channel in ('facebook_messenger','instagram') for update;
 if not found then return jsonb_build_object('ok',false,'reason_code','meta_conversation_required'); end if;
 select * into i from public.assistant_channel_identities where studio_id=p_studio and id::text=c.context->>'identity_id'
  and provider=c.channel and provider_account_id=c.context->>'provider_account_id' and provider_contact_id=c.context->>'provider_contact_id' for update;
 if not found or c.external_thread_ref is distinct from i.provider_account_id||':'||i.provider_contact_id then
  return jsonb_build_object('ok',false,'reason_code','conversation_identity_mismatch'); end if;
 if c.student_id is not null and i.student_id=c.student_id then return jsonb_build_object('ok',true,'identity_verified',true,'already_identified',true); end if;
 if length(coalesce(p_phone,''))>32 or coalesce(p_phone,'') !~ '^[+() 0-9-]+$' then return jsonb_build_object('ok',false,'reason_code','phone_requires_ten_digits'); end if;
 digits:=regexp_replace(p_phone,'[^0-9]','','g');
 if length(digits)=12 and left(digits,2)='52' then digits:=substr(digits,3);
 elsif length(digits)=13 and left(digits,3)='521' then digits:=substr(digits,4); end if;
 if digits !~ '^[0-9]{10}$' or digits ~ '^([0-9])\1{9}$' then return jsonb_build_object('ok',false,'reason_code','phone_requires_ten_digits'); end if;
 v_phone:='+52'||digits;
 select coalesce(jsonb_agg(to_jsonb(matches.person_id)),'[]'::jsonb) into candidates from (
  select pc.person_id from public.person_contacts pc where pc.studio_id=p_studio and pc.kind='phone' and pc.value=v_phone
  union select st.person_id from public.students st where st.studio_id=p_studio and st.phone=v_phone and st.person_id is not null and st.lifecycle_status<>'archived'
 ) matches;
 if jsonb_array_length(candidates)>0 then
  h:=public.assistant_create_handoff(p_studio,p_conversation,null,'technical_block','Verificar identidad del canal antes de vincular una ficha o usar créditos. Un celular escrito no autentica a su titular.');
  if coalesce((h->>'ok')::boolean,false) then
   update public.assistant_handoffs set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('identity_verification',jsonb_build_object('identity_id',i.id,'claimed_phone',v_phone,'candidate_person_ids',candidates))
    where id::text=h->>'handoff_id' and studio_id=p_studio and conversation_id=c.id;
  end if;
  return jsonb_build_object('ok',false,'reason_code','identity_verification_required','human_review_created',coalesce((h->>'ok')::boolean,false),'handoff_id',h->>'handoff_id');
 end if;
 if i.metadata->>'claimed_phone' is not null and i.metadata->>'claimed_phone'<>v_phone then return jsonb_build_object('ok',false,'reason_code','claimed_phone_changed_requires_review'); end if;
 update public.assistant_channel_identities set metadata=metadata||jsonb_build_object('claimed_phone',v_phone,'minimal_identification_completed',true,'phone_authentication_verified',false),updated_at=clock_timestamp() where id=i.id;
 update public.assistant_conversations set context=context||jsonb_build_object('minimal_identification_completed',true),updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('ok',true,'minimal_identification_completed',true,'identity_verified',false,'profile_created',false,'request_full_booking_data',false);
end; $$;
