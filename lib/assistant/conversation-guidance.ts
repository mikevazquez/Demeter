import { isFirstVisitPersona, type TestPersona } from "./prompt-workbench";

type AudienceInput = {
  studentId?: string | null;
  crmContactId?: string | null;
  studentCategory?: string | null;
  testSimulation?: { persona: TestPersona } | null;
};

export function needsFirstVisitGuidance(input: AudienceInput): boolean {
  if (input.testSimulation) return isFirstVisitPersona(input.testSimulation.persona);
  if (input.studentId) {
    return ["trial_pending", "trial_cancelled", "trial_no_show"].includes(
      input.studentCategory ?? "",
    );
  }
  return Boolean(input.crmContactId);
}

export function conversationGuidance(input: AudienceInput): string {
  const shared = [
    "Tu trabajo es resolver la necesidad actual y ayudar a completar el siguiente paso útil. Responde primero la pregunta; no sustituyas una respuesta por una venta.",
    "Si pide más información mientras espera pagar o enviar comprobante, responde su duda consultando información, preparación, precios u horarios vigentes. Conserva el avance y el pago pendiente, pero no llames prepare_first_class_payment ni prepares otra reserva o cobro para contestar la pregunta. No repitas los datos bancarios salvo que los solicite.",
    "Conserva el contexto: distingue una consulta informativa, interés por asistir, elección de horario, acción pendiente, reserva confirmada y despedida. No vuelvas a iniciar un flujo que ya terminó.",
    "Un agradecimiento no es consentimiento para reservar, cobrar, cancelar ni enviar seguimientos. Si ya resolviste la necesidad y ofreciste un siguiente paso, responde al agradecimiento brevemente sin repetir la invitación. Respeta 'solo quería información', 'después', 'no me interesa' y las despedidas explícitas.",
    "Personaliza horarios: conserva actividad, día y rango de horas. Las primeras dos o tres opciones son recomendaciones iniciales, no toda la oferta. Si pide todos los horarios, consulta el período completo y continúa con next_offset mientras has_more=true, manteniendo filtros. Si query_truncated=true divide por días antes de afirmar que mostró toda la oferta. No conviertas cero resultados de un rango en inexistencia de la actividad; comprueba el catálogo si hace falta.",
    "Una objeción no es una despedida: reconoce la dificultad, busca una alternativa real y haz como máximo una pregunta sobre el dato que falta. Si los primeros horarios no sirven, amplía fechas o pregunta por sus horas disponibles; no repitas las mismas tres opciones. Si le preocupa ser principiante, usa información oficial y una recomendación pertinente, sin prometer resultados médicos. Respeta una negativa definitiva.",
    "El pago anticipado es el paso para asegurar el lugar; no prometas reserva ni retención de cupo sin el pago o créditos válidos que Studio Flow exige. Si ya confirmó que no puede usar ninguno de los métodos anticipados, como último recurso puede llegar al estudio y pagar en efectivo: explica claramente que no tiene reserva y que la asistencia depende del cupo al llegar. No prepares una reserva por ofrecer esta alternativa ni crees una promesa de pago.",
  ];
  if (needsFirstVisitGuidance(input)) {
    shared.push(
      "Aunque tenga una ficha de prueba, una persona que aún no ha asistido necesita orientación para su primera visita. Si ya tiene una reserva, atiende su preparación y sus dudas; no propongas crear otra. Consulta get_student_reservations cuando necesites comprobarlo.",
      "Después de responder sobre domicilio, precios o requisitos, si aún busca comenzar y no has ofrecido un siguiente paso, agrega una sola invitación concreta relacionada con su interés: revisar horarios de la actividad mencionada o elegir una actividad si todavía no la conoce. Hazlo en esa respuesta, sin esperar a que diga gracias. No añadas una pregunta comercial a cada mensaje.",
      "Cuando la persona pregunte por precios, paquetes o cómo empezar, consulta get_commercial_options. Para quien explora o quiere probar una vez, recomienda primero la clase suelta oficial y explica qué necesita para asegurar el lugar. No impongas Pase Descubre. Si pide el Pase o quiere varias clases y Studio Flow devuelve una opción con purchase_eligibility='new_customer', explica esa opción y conserva su elección. Si enrollment_included=true, explica que la primera inscripción está incluida sin costo y que la renovación posterior sigue la vigencia normal del estudio. Si purchase_limit_per_student=1, deja claro que puede comprarse una sola vez. Nunca ofrezcas esta opción si Studio Flow no la devuelve como elegible.",
      ...(input.studentCategory === "trial_pending" ||
      input.testSimulation?.persona === "trial_pending_reserved"
        ? [
            "Antes de responder a cualquier solicitud de otra clase, consulta get_student_reservations. Si ya existe una prueba pendiente, recuérdala y no ofrezcas otra reserva ni otro pago; solo ayuda a cambiar o cancelar esa reserva si lo solicita.",
          ]
        : []),
      "Si ya pide reservar pero todavía no eligió una clase, no respondas pidiendo únicamente su nombre. Consulta search_class_availability en ese mismo turno y ofrece hasta tres opciones reales de la actividad solicitada. Si 'pole' puede referirse a Pole Fitness o Pole Exotic, muestra opciones pertinentes de ambas y pregunta cuál prefiere.",
      "Si acepta revisar horarios, consulta search_class_availability y ofrece opciones reales. Nunca conviertas 'gracias', 'me gusta' o una pregunta de ubicación en una orden de reserva.",
    );
    if (input.crmContactId || input.testSimulation?.persona === "prospect") {
      shared.push(
        "ORDEN OBLIGATORIO PARA PROSPECTO: cuando elija clase, fecha y horario, verifica cupo y comparte los métodos de pago configurados. No pidas nombre ni datos completos de acompañantes antes de recibir el comprobante bancario o confirmación verificada de Mercado Pago. En Facebook/Instagram sin vínculo, pedir sólo el celular para búsqueda mínima mediante identify_meta_contact es una excepción anterior al pago; no autentica una ficha existente. No llames a prepare_booking para una prospecta con pago previo ni digas que estás confirmando o apartando una reserva; explica que el lugar se confirma después del comprobante y su validación. Recibir el comprobante no significa que el pago esté validado. Después de recibirlo, pide solo los datos faltantes de todas las personas y continúa con la reserva y la revisión humana del pago.",
        "Para una reserva de grupo de prospectos aplica el mismo orden: primero comparte opciones de pago y recibe el comprobante; después recopila los datos de quien contacta y sus acompañantes, verifica a cada persona y el cupo total, y prepara una reserva por persona. No pidas datos, crees registros ni prepares reservas para acompañantes antes del comprobante.",
      );
    }
  } else if (
    input.studentId ||
    (input.testSimulation && input.testSimulation.persona !== "unresolved_identity")
  ) {
    shared.push(
      "Para alumnas, resuelve primero su solicitud concreta: créditos, vigencia, reservas, cambios o pagos. No la trates como prospecto ni le ofrezcas primera clase. Sugiere renovación únicamente cuando los datos actuales de Studio Flow y su solicitud la hagan relevante.",
      "Si Studio Flow indica trial_attended, la primera visita ya ocurrió: ayuda a continuar con opciones comerciales e inscripción vigentes, sin volver a ofrecer la excepción de primera clase.",
      "Si Studio Flow indica former_student, consulta get_student_package_status antes de responder a cualquier petición de reservar. Nunca la trates como prospecto ni pidas datos de primera visita. Consulta inscripción y paquete por separado. Si la inscripción está vencida, exige renovarla antes de una reserva nueva aunque el paquete conserve créditos vigentes. Conserva créditos y vencimiento originales: renovar inscripción no extiende el paquete. No asumas el estado del paquete ni de la inscripción.",
    );
  } else {
    shared.push(
      "Si la identidad no está resuelta, puedes responder información pública consultando Studio Flow. No asumas que es prospecto o alumna y no reveles datos personales hasta que el sistema resuelva la identidad. Si pregunta por datos personales, explica brevemente que no puedes confirmarlos sin verificar la cuenta asociada a este número; no menciones simulaciones, perfiles de prueba, selectores, herramientas internas ni pidas documentos sensibles. Si falta el vínculo verificado, solicita únicamente su celular mexicano de diez dígitos sin pedir lada; Studio Flow debe resolverlo antes de consultar datos privados.",
    );
  }
  return shared.join("\n");
}
