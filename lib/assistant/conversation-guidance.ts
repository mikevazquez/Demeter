import { isFirstVisitPersona, type TestPersona } from "./prompt-workbench";

type AudienceInput = {
  studentId?: string | null;
  crmContactId?: string | null;
  studentCategory?: string | null;
  testSimulation?: { persona: TestPersona; reservations?: readonly unknown[] } | null;
};

type PaymentHistory = readonly { role: string; content: string }[];

function asksForExplanation(text: string): boolean {
  return /por qu[eé]|no (?:lo )?ent(?:end[ií]|iendo)|expl[ií]ca|otra forma/i.test(text);
}

export function explanationTurnGuidance(history: PaymentHistory): string {
  const current = history.at(-1);
  if (current?.role !== "user" || !asksForExplanation(current.content)) return "";
  return "ESTE TURNO PIDE UNA EXPLICACIÓN: contesta la duda reformulando el motivo concreto en palabras sencillas, con empatía y sin culpar a la persona. Consultar datos actuales puede ser necesario; pedir una explicación no autoriza preparar ni ejecutar una nueva acción. No repitas la confirmación de una acción pendiente ni cierres con otra pregunta: espera a que la persona decida después de entender. Si explicas una lista de espera, no la confundas con una reserva ni prometas entrar; si se libera un lugar y le corresponde, Studio Flow intentará reservarlo automáticamente según las reglas. No la describas como sólo un aviso.";
}

export function prospectCashPaymentStage(
  input: AudienceInput,
  history: PaymentHistory,
): "first_objection" | "second_refusal" | null {
  const prospect = input.testSimulation
    ? input.testSimulation.persona === "prospect"
    : Boolean(input.crmContactId) && !input.studentId;
  if (!prospect || history.at(-1)?.role !== "user" || input.testSimulation?.reservations?.length)
    return null;
  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const current = normalize(history.at(-1)!.content);
  if (
    /(?:hablar|comunicarme|pasame|comunica).{0,40}(?:persona|humano|alguien del equipo)|no (?:quiero ir|quiero asistir|me interesa)|ya no voy|mejor (?:ya )?no voy/.test(
      current,
    )
  )
    return null;
  let objections = 0;
  let paymentContext = false;
  let currentIsObjection = false;
  let currentIsExplanation = false;
  for (const message of history) {
    const text = normalize(message.content);
    if (message.role === "assistant") {
      paymentContext = /anticipo|anticipad|transfer|deposit|forma de pago|efectivo/.test(text);
      continue;
    }
    if (message.role !== "user") continue;
    // Accepting advance payment ends the objection sequence. Do not count a
    // negated cash preference ("no quiero efectivo, prefiero transferencia").
    const acceptsAdvance =
      /(?:mejor si|si puedo|acepto|prefiero|quiero|pasame|comparteme).{0,65}(?:transfer|oxxo|deposit|anticipad)/.test(
        text,
      ) && !/no (?:puedo|quiero|acepto)|tampoco puedo/.test(text);
    const rejectsCash = /no (?:quiero|prefiero).{0,25}efectivo/.test(text);
    if (acceptsAdvance || rejectsCash) {
      objections = 0;
      currentIsObjection = false;
      currentIsExplanation = false;
      continue;
    }
    const cashRequest =
      /(?:pagar|pago|pagare|puedo|solo|solamente|unicamente|prefiero|quiero|tengo|aceptan).{0,35}efectivo|pago al llegar|^efectivo[.!]?$/.test(
        text,
      );
    const rejectsAdvance =
      /(?:no|tampoco) (?:puedo|quiero).{0,40}(?:transfer|deposit|adelant|anticipad)/.test(text);
    const contextualRefusal =
      paymentContext && /^(?:no gracias[, .]*)?(?:no|tampoco) puedo[.!]?$/.test(text.trim());
    currentIsObjection = cashRequest || rejectsAdvance || contextualRefusal;
    currentIsExplanation = paymentContext && objections > 0 && asksForExplanation(text);
    if (currentIsObjection) objections += 1;
  }
  if (!currentIsObjection && !currentIsExplanation) return null;
  return objections >= 2 ? "second_refusal" : "first_objection";
}

export function prospectCashTurnGuidance(input: AudienceInput, history: PaymentHistory): string {
  const stage = prospectCashPaymentStage(input, history);
  if (stage === "first_objection")
    return "ETAPA DE PAGO DE ESTE TURNO: PRIMERA OBJECIÓN. Responde con empatía y explica una sola vez el anticipo para asegurar su primera clase, conservando los métodos habilitados. En esta respuesta NO ofrezcas acudir sin reserva ni pagar en efectivo al llegar, tampoco como posibilidad condicional. Espera una nueva negativa antes de ofrecer esa alternativa. No reserves ni derives a un humano por esta objeción.";
  if (stage === "second_refusal")
    return "ETAPA DE PAGO DE ESTE TURNO: SEGUNDA NEGATIVA. Deja de insistir en el anticipo. Explica con empatía que puede acudir y pagar en efectivo ese día sólo si hay cupo al llegar. Las clases se agendan con anticipación: va sin reserva y no se garantiza que pueda tomar la clase. No crees ficha, reserva, retención, compra, promesa de pago ni atención humana por esta negativa.";
  return "";
}

export function prospectCashTurnReply(
  input: AudienceInput,
  history: PaymentHistory,
): string | null {
  const stage = prospectCashPaymentStage(input, history);
  if (stage === "first_objection" && asksForExplanation(history.at(-1)?.content ?? ""))
    return history.at(-2)?.content.includes("la clase tiene un límite de lugares")
      ? "Por ejemplo: elegir un horario me dice a qué clase quieres ir; completar el pago anticipado permite confirmar tu reserva para esa clase. Son dos pasos distintos. Si sólo elegimos el horario, todavía no hay una reserva a tu nombre."
      : "Claro: la clase tiene un límite de lugares. El pago anticipado es el paso que permite confirmar uno para ti; mientras no se complete ese paso, otras personas pueden reservarlo. Por eso, sin el pago por adelantado no se confirma una reserva a tu nombre.";
  if (stage === "first_objection")
    return "Entiendo que prefieras pagar en efectivo. Como los lugares se reservan con anticipación, el pago por adelantado nos permite confirmar un lugar para tu primera clase. Sin ese pago, el lugar sigue disponible para otras personas y no queda reservado a tu nombre. Puedes hacerlo por alguno de los métodos habilitados.";
  if (stage === "second_refusal")
    return history.some(
      (message) =>
        message.role === "assistant" &&
        message.content.includes("recepción recibe y registra el pago") &&
        message.content.includes("únicamente si hay lugar"),
    )
      ? "Claro, te lo explico de otra forma: pagarías en efectivo directamente con recepción al llegar al estudio. Si en ese momento hay un lugar libre, puedes tomar la clase; si todos los lugares ya están reservados, no podrías entrar a esa clase. Por eso la visita sería sin reserva y no puedo asegurarte un lugar."
      : "Entiendo que el pago anticipado no sea una opción para ti. Puedes acercarte al estudio y pagar la clase ese día en efectivo, únicamente si hay lugar al llegar; recepción recibe y registra el pago. Como las clases se agendan con anticipación, irías sin reserva y no podemos garantizarte que haya espacio para tomarla.";
  return null;
}

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
    "Ante una objeción, reconoce primero lo que la persona quiere en concreto y explica por qué existe la limitación, usando sólo las reglas y datos verificados. No basta con repetir la regla ni añadir 'entiendo' al mismo texto. Si insiste, pregunta por qué o dice que no entendió, reformula en palabras más sencillas o con un ejemplo breve y ofrece una alternativa real. No inventes motivos, excepciones ni disponibilidad para sonar empática; si el motivo no está disponible, dilo sin especular. Evita sonar condescendiente y no culpes a la persona por no entender.",
    "Si quiere una clase que Studio Flow indica llena, reconoce su preferencia por ese horario y explica que los lugares ya están ocupados, por lo que no puedes confirmar otro. Si vuelve a pedir ese horario, aclara que su preferencia se entiende pero no crea un lugar libre; ofrece consultar otra fecha u horario real y conserva la actividad y profesor solicitados. No vuelvas a ejecutar la misma reserva sólo por insistencia ni prometas lista de espera o cupo sin elegibilidad verificada. Una consulta nueva de disponibilidad sí puede comprobar si cambió el cupo.",
    "El efectivo se entrega en el estudio: recepción recibe y registra el pago. Demi sólo informa sobre ese cobro; no recibe efectivo, no pide comprobantes de efectivo ni promete revisarlo o validarlo. Si dice 'ya pagué en efectivo', informa con naturalidad: 'Gracias por avisarme. El efectivo lo registra recepción directamente en el estudio; no necesitas enviarme un comprobante'. No lo des por pagado sin el registro del sistema ni inicies una revisión de transferencia. Evita expresiones acusatorias como 'decirme que pagaste no acredita el pago'. Puedes consultar el estado ya registrado en Studio Flow si pregunta por su saldo o adeudo. El alta autorizada de un paquete por cobrar para una alumna identificada conserva sus reglas y advertencias; no es un cobro recibido.",
    "No prometas reserva ni retención de cupo sin el pago o créditos válidos que Studio Flow exige. Ofrecer una visita sin reserva no crea una reserva, retiene cupo ni registra una promesa de pago.",
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
        "EFECTIVO EN PRIMERA CLASE DE PROSPECTO SIN RESERVA: primero explica que para asegurar su lugar necesita pagar por adelantado y ofrece transferencia o depósito OXXO a Bancomer únicamente si Studio Flow los devuelve habilitados. Ante la primera petición de efectivo o dificultad para transferir, reconoce la dificultad y explica una sola vez que para esta primera ocasión el pago anticipado permite asegurar el lugar; conserva las alternativas habilitadas, incluido el depósito OXXO, sin afirmar que sólo existe transferencia. En esa primera objeción TODAVÍA NO ofrezcas acudir sin reserva ni pagar en efectivo al llegar, ni siquiera como posibilidad condicional: espera otra negativa de la persona después de tu explicación.",
        "Si después de esa explicación vuelve a rechazar el anticipo, dice que no puede o insiste en efectivo, esa segunda negativa basta: no insistas una tercera vez ni derives a un humano por esa negativa. Responde con empatía que puede acudir al estudio y pagar la clase ese día en efectivo únicamente si hay lugar al llegar. Explica que las clases se agendan con anticipación, que no tiene reserva y que no se garantiza cupo ni que pueda tomar la clase. No crees ficha, reserva, retención de cupo, compra ni promesa de pago para ofrecer esa alternativa. Si rechaza también acudir, respeta su decisión y cierra sin presionar.",
        "Estas dos negativas son objeciones de pago dentro del historial de la misma conversación, no fallos técnicos ni el contador de errores de reservas. Una consulta de ubicación u horarios no es otra negativa. Si cambia de opinión y acepta un método anticipado habilitado, continúa el flujo normal de pago sin seguir ofreciendo la visita sin reserva. No uses policy_exception ni technical_block sólo por preferir efectivo o no poder transferir; una petición explícita de hablar con alguien u otro motivo habilitado conserva su propia política de atención humana. Este recorrido no sustituye la compra de paquete con deuda y fecha acordada de una alumna identificada ni cancela una reserva existente.",
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
