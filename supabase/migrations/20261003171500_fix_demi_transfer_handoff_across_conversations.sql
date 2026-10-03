create or replace function public.assistant_create_handoff(
  target_studio_id uuid,
  target_conversation_id uuid,
  target_student_id uuid,
  target_reason_code text,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if coalesce((select auth.role()),'') <> 'service_role'
     and not private.has_capability(target_studio_id,'settings.write') then
    raise exception 'forbidden';
  end if;

  select ah.id into v_id
  from public.assistant_handoffs ah
  where ah.studio_id=target_studio_id
    and ah.conversation_id=target_conversation_id
    and ah.status='open'
  order by ah.created_at desc
  limit 1;

  if v_id is null then
    insert into public.assistant_handoffs(
      studio_id,conversation_id,student_id,reason_code,note,status
    )
    values(
      target_studio_id,target_conversation_id,target_student_id,
      left(coalesce(nullif(trim(target_reason_code),''),'human_review'),120),
      nullif(left(trim(coalesce(target_note,'')),1000),''),
      'open'
    )
    returning id into v_id;
  end if;

  if target_reason_code='transfer_receipt_review' then
    update public.assistant_enrollment_intents aei
    set status='human_review',
        updated_at=now()
    where aei.id=(
      select aei2.id
      from public.assistant_enrollment_intents aei2
      where aei2.studio_id=target_studio_id
        and aei2.student_id=target_student_id
        and aei2.payment_method='bank_transfer'
        and aei2.status='receipt_required'
      order by aei2.created_at desc
      limit 1
    );
  end if;

  return jsonb_build_object('ok',true,'handoff_id',v_id,'status','open');
end;
$function$;
