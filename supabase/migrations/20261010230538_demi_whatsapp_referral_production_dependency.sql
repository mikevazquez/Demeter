CREATE OR REPLACE FUNCTION public.service_record_meta_whatsapp_referral(target_studio_id uuid, target_crm_conversation_id uuid, target_crm_contact_id uuid, target_referral jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contact_id uuid;
  v_referral jsonb;
begin
  if coalesce((select auth.role()),'') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if target_studio_id is null
     or target_crm_conversation_id is null
     or target_referral is null
     or jsonb_typeof(target_referral) <> 'object' then
    return jsonb_build_object('ok',false,'reason_code','invalid_input');
  end if;

  select crm_contact_id into v_contact_id
  from public.crm_conversations
  where id=target_crm_conversation_id
    and studio_id=target_studio_id
    and provider='meta_whatsapp'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason_code','crm_conversation_not_found');
  end if;

  if target_crm_contact_id is not null
     and v_contact_id is distinct from target_crm_contact_id then
    return jsonb_build_object('ok',false,'reason_code','crm_contact_mismatch');
  end if;

  v_referral := jsonb_strip_nulls(
    jsonb_build_object(
      'source_url', nullif(trim(coalesce(target_referral->>'source_url','')),''),
      'source_type', nullif(trim(coalesce(target_referral->>'source_type','')),''),
      'source_id', nullif(trim(coalesce(target_referral->>'source_id','')),''),
      'headline', nullif(trim(coalesce(target_referral->>'headline','')),''),
      'body', nullif(trim(coalesce(target_referral->>'body','')),''),
      'media_type', nullif(trim(coalesce(target_referral->>'media_type','')),''),
      'ctwa_clid', nullif(trim(coalesce(target_referral->>'ctwa_clid','')),'')
    )
  );

  if v_referral = '{}'::jsonb then
    return jsonb_build_object('ok',false,'reason_code','referral_empty');
  end if;

  update public.crm_conversations
  set source='Meta Ads',
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'meta_referral',v_referral,
        'meta_attributed_at',clock_timestamp()
      ),
      updated_at=clock_timestamp()
  where id=target_crm_conversation_id
    and studio_id=target_studio_id;

  if v_contact_id is not null then
    update public.crm_contacts
    set source='Meta Ads',
        updated_at=clock_timestamp()
    where id=v_contact_id
      and studio_id=target_studio_id
      and (source is null or lower(trim(source)) in ('meta_whatsapp','whatsapp','assistant'));
  end if;

  return jsonb_build_object(
    'ok',true,
    'crm_conversation_id',target_crm_conversation_id,
    'crm_contact_id',v_contact_id,
    'source','Meta Ads',
    'referral',v_referral
  );
end;
$function$
;
revoke all on function public.service_record_meta_whatsapp_referral(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_record_meta_whatsapp_referral(uuid,uuid,uuid,jsonb) to service_role;
