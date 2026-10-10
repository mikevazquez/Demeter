create function public.service_get_demi_followup_message(p_id uuid,p_token uuid,p_now timestamptz default clock_timestamp())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.demi_followups%rowtype; g public.demi_group_bookings%rowtype; stage text:='information'; body text;
 args jsonb; participant jsonb; missing text[]:='{}'; idx integer:=0; prefix text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select * into f from public.demi_followups where id=p_id and state='processing' and lease_token=p_token and lease_until>p_now;
 if not found then return jsonb_build_object('ok',false,'reason_code','lease_mismatch'); end if;
 if private.demi_followup_stop_reason(f,p_now) is not null then return jsonb_build_object('ok',false,'reason_code','followup_no_longer_eligible'); end if;
 if f.kind='prospect' then
  select * into g from public.demi_group_bookings where studio_id=f.studio_id and conversation_id=f.conversation_id and status in ('awaiting_receipt','awaiting_participants') order by created_at desc limit 1;
  if found and g.status='awaiting_receipt' then
   stage:='awaiting_receipt';
   if exists(select 1 from public.demi_payment_requests where group_id=g.id and studio_id=f.studio_id and status in ('created','order_created','pending')) then
    body:='El pago de Mercado Pago aún no aparece confirmado. Si ya lo realizaste, no necesitas enviar comprobante: esperamos la confirmación del proveedor antes de continuar.';
   else body:='¿Pudiste realizar la transferencia o depósito a Bancomer? Si ya pagaste, envía el comprobante para que el equipo lo revise. Aún no hay una reserva confirmada.'; end if;
  elsif found and g.status='awaiting_participants' then
   stage:='awaiting_participants';
   select request_json into args from public.assistant_tool_executions where studio_id=f.studio_id and conversation_id=f.conversation_id and tool_name='complete_group_booking' and request_json->>'group_id'=g.id::text order by created_at desc limit 1;
   if jsonb_typeof(args->'participants')='array' then
    for participant in select value from jsonb_array_elements(args->'participants') loop
     idx:=idx+1;
     if length(trim(coalesce(participant->>'name','')))<3 then missing:=array_append(missing,'nombre completo de la persona '||idx); end if;
     if coalesce(participant->>'phone','') !~ '^[0-9]{10}$' then missing:=array_append(missing,'celular de diez dígitos de la persona '||idx); end if;
    end loop;
   else missing:=array['nombre completo y celular de diez dígitos de quienes asistirán']; end if;
   if array_length(missing,1) is null then body:='Recibimos los datos. Falta concluir su revisión; no hay una reserva confirmada todavía.';
   else body:='Para continuar faltan: '||array_to_string(missing,', ')||'. ¿Puedes compartirlos? Todavía debemos verificar el cupo antes de confirmar.'; end if;
  else body:='¿Te quedó alguna duda sobre los horarios o cómo empezar? Si quieres continuar, revisamos las opciones disponibles.'; end if;
 else
  stage:=f.kind;
  body:=case f.kind
   when 'post_trial' then '¿Cómo te fue en tu primera clase? Si quieres continuar, podemos revisar las opciones de inscripción y paquete. No se activa una inscripción por manifestar interés.'
   when 'enrollment' then 'Tu inscripción requiere renovación. Podemos revisar las opciones para volver a reservar; renovar la inscripción no reinicia ni extiende tu paquete.'
   when 'package' then '¿Quieres revisar opciones para renovar tu paquete? Consultaremos inscripción y créditos vigentes antes de reservar.'
   when 'package_expiring' then 'Tu paquete está próximo a vencer. Podemos consultar su vigencia y las opciones disponibles para usar tus créditos.'
   when 'package_expired' then 'Tu paquete llegó a su vencimiento. Si quieres continuar, podemos consultar opciones de renovación y el estado de tu inscripción.'
   when 'inactive' then 'Hace tiempo que no te vemos en clase. Si quieres regresar, revisamos tu inscripción, paquete y horarios disponibles.'
   else null end;
 end if;
 if body is null then return jsonb_build_object('ok',false,'reason_code','followup_content_unavailable'); end if;
 prefix:=case when f.step=2 and f.kind in ('prospect','post_trial') then 'Último seguimiento de esta consulta. ' else '' end;
 return jsonb_build_object('ok',true,'stage',stage,'text',prefix||body,'source_ref',f.source_ref,'template_key',
  case when f.kind='prospect' then 'prospect_'||stage||'_'||f.step else f.kind||'_'||f.step end);
end; $$;
revoke all on function public.service_get_demi_followup_message(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.service_get_demi_followup_message(uuid,uuid,timestamptz) to service_role;

create or replace function public.admin_save_demi_followup_settings(p_studio uuid,p_enabled boolean,p_interval integer,p_templates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_capability(p_studio,'settings.write') then raise exception 'forbidden'; end if;
 if p_interval is null or p_interval not between 1 and 720 or jsonb_typeof(p_templates) is distinct from 'object' then raise exception 'invalid_followup_settings'; end if;
 if exists(select 1 from jsonb_each(p_templates) e where e.key !~ '^((prospect|post_trial|package|enrollment|inactive|package_expiring|package_expired)_[123]|prospect_(information|awaiting_receipt|awaiting_participants)_[12])$' or jsonb_typeof(e.value) is distinct from 'object' or coalesce(e.value->>'name','') !~ '^[a-z0-9_]{1,512}$' or (e.value ? 'components' and jsonb_typeof(e.value->'components') is distinct from 'array') or (e.value ? 'bind_message_body' and jsonb_typeof(e.value->'bind_message_body') is distinct from 'boolean')) then raise exception 'invalid_meta_template'; end if;
 insert into public.demi_followup_settings(studio_id,enabled,prospect_interval_hours,templates) values(p_studio,p_enabled,p_interval,p_templates)
 on conflict(studio_id) do update set enabled=excluded.enabled,prospect_interval_hours=excluded.prospect_interval_hours,templates=excluded.templates;
 if not p_enabled then update public.demi_followups set state='cancelled',reason_code='followups_disabled',lease_token=null,lease_until=null where studio_id=p_studio and state in ('pending','processing'); end if;
 return jsonb_build_object('ok',true);
end; $$;
