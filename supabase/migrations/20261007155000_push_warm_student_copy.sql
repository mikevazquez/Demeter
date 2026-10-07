do $migration$
declare
  v_rule record;
  v_title text;
  v_body text;
begin
  for v_rule in
    select r.id, v.template_key, rc.channel_policy
    from public.studios s
    join public.notification_rules r on r.studio_id = s.id
    join public.notification_rule_versions v
      on v.studio_id = r.studio_id
     and v.rule_id = r.id
     and v.version_number = r.current_version_number
    join public.notification_rule_channels rc
      on rc.studio_id = r.studio_id
     and rc.rule_id = r.id
     and rc.version_number = r.current_version_number
     and rc.channel_key = 'push'
    where s.slug = 'demeter-fitness'
      and r.archived_at is null
      and nullif(trim(rc.channel_policy->>'title_template'), '') is not null
      and nullif(trim(rc.channel_policy->>'body_template'), '') is not null
  loop
    v_title := case v_rule.template_key
      when 'account_created' then '👋 ¡Qué gusto tenerte aquí!'
      when 'attendance_no_show' then '💚 Te esperamos en clase'
      when 'credit_restored' then '🎁 ¡Buenas noticias!'
      when 'document_new_version' then '📄 Actualizamos un documento'
      when 'documents_pending' then '📝 Dejemos todo listo'
      when 'evaluation_reminder' then '⏰ ¡Tu evaluación ya casi llega!'
      when 'guardian_signature_pending' then '✍️ Falta una firma'
      when 'late_cancellation' then '⏰ Tu cancelación quedó registrada'
      when 'package_activated' then '🎉 ¡A disfrutar tu paquete!'
      when 'package_expired' then '💚 Nos encantará verte de nuevo'
      when 'package_expiring' then '⏳ Tu paquete está por vencer'
      when 'password_reset' then '🔐 Tu acceso está listo'
      when 'payment_confirmed' then '✅ ¡Pago recibido!'
      when 'payment_pending' then '💳 Te ayudamos con tu pago'
      when 'reservation_cancelled_by_student' then '😔 Tu reserva quedó cancelada'
      when 'reservation_confirmed' then '✨ ¡Tu lugar está reservado!'
      when 'reservation_modified' then '🗓️ Actualizamos tu reserva'
      when 'session_cancelled_by_studio' then '😔 Un cambio en tu clase'
      when 'session_coach_changed' then '👩‍🏫 Tenemos una actualización'
      when 'studio_closure' then '📢 Un aviso sobre tu clase'
      when 'waitlist_expired' then '💚 ¿Buscamos otra clase?'
      when 'waitlist_promoted' then '🎉 ¡Ya tienes lugar!'
      else null
    end;
    v_body := case v_rule.template_key
      when 'account_created' then '¡Qué gusto tenerte en Demeter! 👋 Tu cuenta ya está lista. Actívala cuando puedas; nos encantará acompañarte en tus clases 💚'
      when 'attendance_no_show' then 'Hoy no pudimos verte en clase 😔. Cuando quieras, aquí estamos para ayudarte a planear tu próxima visita 💚'
      when 'credit_restored' then '¡Buenas noticias! 🎁 El crédito de tu reserva ya volvió a tu paquete. ¡Te esperamos pronto en clase! 💚'
      when 'document_new_version' then 'Actualizamos un documento del estudio 📄 Cuando tengas un momento, revísalo en Demeter. Si necesitas ayuda, aquí estamos 💚'
      when 'documents_pending' then 'Para que puedas seguir disfrutando de Demeter, tienes un documento pendiente 📝 Revísalo en tu cuenta y, si necesitas apoyo, aquí estamos 💚'
      when 'evaluation_reminder' then '¡Tu evaluación está muy cerca! ⏰ Revisa en Demeter los detalles y prepárate con calma. Nos emociona ver tu avance 💚'
      when 'guardian_signature_pending' then 'Para completar el proceso, falta la firma de tu responsable ✍️ Revísenlo en Demeter cuando puedan. Si necesitan apoyo, aquí estamos 💚'
      when 'late_cancellation' then 'Tu cancelación quedó registrada ⏰ Puedes revisar en Demeter el estado de tu crédito. Si algo no te queda claro, escríbenos y lo revisamos contigo 💚'
      when 'package_activated' then '¡Qué emoción seguir entrenando contigo! 🎉 Tu paquete ya está activo. Revisa su vigencia y créditos en Demeter, y disfruta cada clase 💚'
      when 'package_expired' then 'Tu paquete terminó su vigencia, pero nos encantará verte de nuevo 💚 Revisa en Demeter las opciones para seguir entrenando ✨'
      when 'package_expiring' then 'Tu paquete está por vencer ⏳ Revisa su vigencia en Demeter y, si quieres seguir reservando, aquí estamos para ayudarte 💚'
      when 'password_reset' then 'Solicitaste un nuevo acceso temporal 🔐 Entra con el enlace recibido y cambia tu contraseña. Si no fuiste tú, avísanos de inmediato.'
      when 'payment_confirmed' then '¡Listo, tu pago quedó registrado! ✅ Gracias por tu confianza. Puedes consultar los detalles en Demeter 💚'
      when 'payment_pending' then 'Tu pago sigue pendiente 💳 Si ya lo realizaste, comparte tu comprobante y con gusto te ayudamos a revisarlo 💚'
      when 'reservation_cancelled_by_student' then 'Tu reserva ya quedó cancelada 😔 Si quieres agendar otra clase, aquí estamos para ayudarte 💚'
      when 'reservation_confirmed' then '¡Nos encantará verte en clase! ✨ Tu lugar ya está reservado. Revisa en Demeter todos los detalles 💚'
      when 'reservation_modified' then '¡Actualizamos tu reserva! 🗓️ Revisa los detalles en Demeter; si necesitas ayuda, aquí estamos para ti 💚'
      when 'session_cancelled_by_studio' then 'Lo sentimos 😔 Tu clase tuvo que cancelarse. Revisa en Demeter el estado de tu reserva y crédito; si necesitas ayuda, aquí estamos 💚'
      when 'session_coach_changed' then 'Tenemos una actualización para ti 👩‍🏫 Cambió el coach de una de tus próximas clases. Revisa tu agenda; ¡te esperamos con gusto! 💚'
      when 'studio_closure' then 'Hay un cambio en el estudio que afecta tu clase 📢 Revisa los detalles de tu reserva en Demeter; si necesitas apoyo, escríbenos 💚'
      when 'waitlist_expired' then 'Esta vez no se liberó un lugar a tiempo 🥺 Puedes revisar otras opciones en Demeter; nos encantará verte en otra clase 💚'
      when 'waitlist_promoted' then '¡Buenas noticias! 🎉 Se liberó un lugar y tu reserva ya está confirmada. ¡Te esperamos con mucho gusto! 💚'
      else null
    end;
    if v_title is null or v_body is null then
      continue;
    end if;
    if v_rule.channel_policy->>'title_template' = v_title
       and v_rule.channel_policy->>'body_template' = v_body then
      continue;
    end if;
    perform private.clone_notification_rule_version(
      v_rule.id, 'push', null, 'set', v_title, v_body, null
    );
  end loop;

  update public.notification_marketing_configs m
  set title_template = case m.marketing_key
        when 'challenges' then '🏆 ¡Hay un nuevo reto para ti!'
        when 'events' then '🎟️ ¡Tenemos un plan especial!'
        when 'package-recovery-1' then '💖 ¡Te extrañamos en clase!'
        when 'package-recovery-2' then '🫶 Nos encantará volver a verte'
        when 'referrals' then '🤸 Comparte tu pasión por el movimiento'
        else m.title_template
      end,
      body_template = case m.marketing_key
        when 'challenges' then '¡Tenemos un nuevo reto para ti! 🏆 Anímate a moverte, disfrutar y compartir el camino. ¡Nos encantará verte! 💚'
        when 'events' then 'Preparamos un evento especial para disfrutar juntas 🎟️ Revisa los detalles en Demeter; ¡ojalá puedas acompañarnos! 💚'
        when 'package-recovery-1' then 'Ha pasado un tiempo desde tus últimas clases y te extrañamos 💖 Si te gustaría volver, escríbenos; buscamos juntas una opción que se adapte a ti 💚'
        when 'package-recovery-2' then 'Nos encantaría volver a verte por aquí 🫶 Cuando quieras retomar tus clases, estamos para acompañarte y contarte las opciones disponibles 💚'
        when 'referrals' then '¿Con quién te gustaría compartir tu pasión por el movimiento? 🤸 Invita a alguien especial a conocer Demeter; nos encantará recibirle 💚'
        else m.body_template
      end,
      updated_at = clock_timestamp()
  from public.studios s
  where s.id = m.studio_id
    and s.slug = 'demeter-fitness'
    and m.marketing_key in (
      'challenges', 'events', 'package-recovery-1', 'package-recovery-2', 'referrals'
    );
end;
$migration$;
