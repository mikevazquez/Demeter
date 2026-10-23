import "server-only";

export type AssistantPermissionClass = "A" | "B" | "C";

export type SearchClassAvailabilityArgs = {
  activity_query: string | null;
  date_from: string;
  date_to: string;
  after_time: string | null;
  before_time: string | null;
  limit: number;
  offset?: number;
};

export type CommercialOptionsArgs = {
  session_ref: string | null;
};

export type EmptyArgs = Record<string, never>;

export type AssistantToolDefinition = {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};

export const assistantReadToolDefinitions: AssistantToolDefinition[] = [
  {
    type: "function",
    name: "get_workshop_purchases",
    strict: true,
    description:
      "Consulta compras y saldos de talleres de la alumna verificada en esta conversación, incluida continuidad ya registrada y si se entregó una pregunta de seguimiento. No divulga compras de otra persona. No repitas preguntas si ya respondió o liquidó.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_workshop_options",
    strict: true,
    description:
      "Consulta talleres reales, fechas y horas locales, precios completo/individual, anticipo e inscripción. enabled=false indica que Demi no tiene habilitadas las altas, no que el estudio carezca de talleres. current_purchase recupera el estado real de la solicitud de esta conversación: consúltalo al retomar un pago o comprobante, antes de pedir otro. Usa referencias exactas para comprar; los paquetes regulares no cubren estas fechas. El contenido temporal no reemplaza catálogo ni confirma cupos.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "search_class_availability",
    description:
      "Consulta clases reales y lugares disponibles en Studio Flow. Úsala siempre para preguntas de horarios, fechas, 'hoy', 'mañana', horas concretas o disponibilidad. Cada llamada admite como máximo 14 días inclusivos (date_to menos date_from <= 13 días). Para un día de semana concreto, empieza por su próxima fecha; amplía por tramos sólo si hace falta. Si pide todo un período, recórrelo por tramos de hasta 14 días y pagina con next_offset sin omitir resultados. No devuelve precios comerciales; para precios usa get_commercial_options. Nunca inventes una clase. Si la persona nombra una actividad concreta, conserva ese nombre exacto en activity_query; no lo abrevies a una categoría más amplia.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        activity_query: {
          type: ["string", "null"],
          description:
            "Nombre o fragmento de la actividad/disciplina, por ejemplo 'pole', 'aro' o 'twerk'. null si la persona pregunta por todas las clases.",
        },
        date_from: {
          type: "string",
          description: "Fecha inicial local del estudio en formato YYYY-MM-DD.",
        },
        date_to: {
          type: "string",
          description:
            "Fecha final local YYYY-MM-DD, inclusiva y como máximo 13 días después de date_from (14 días en total).",
        },
        after_time: {
          type: ["string", "null"],
          description: "Hora mínima local HH:MM, o null.",
        },
        before_time: {
          type: ["string", "null"],
          description: "Hora máxima local HH:MM, o null.",
        },
        limit: {
          type: "integer",
          description: "Máximo de resultados. Usa normalmente 10 y nunca más de 20.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description:
            "Empieza en 0. Para continuar la misma búsqueda usa next_offset del resultado anterior; conserva los mismos filtros.",
        },
      },
      required: [
        "activity_query",
        "date_from",
        "date_to",
        "after_time",
        "before_time",
        "limit",
        "offset",
      ],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_activity_catalog",
    description:
      "Consulta las actividades y disciplinas reales configuradas por el estudio. Para precios usa get_commercial_options.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_commercial_options",
    description:
      "Consulta paquetes, membresías y precios activos reales de Studio Flow. Si buscas qué producto permite reservar una clase concreta, envía la session_ref exacta y Studio Flow devolverá únicamente opciones compatibles con esa sesión. Para una consulta comercial general usa session_ref=null. No inventes promociones ni compatibilidades.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        session_ref: {
          type: ["string", "null"],
          description:
            "Referencia session:<uuid> de una clase concreta cuando se necesitan productos que realmente la cubran; null para consultar el catálogo general.",
        },
      },
      required: ["session_ref"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_temporary_information",
    description:
      "Consulta eventos, talleres y promociones vigentes del estudio, junto con studio_defaults. Úsala para fechas, precio, horario, ubicación y cómo pagar un taller. El taller define sus datos específicos. Para ubicación, contacto y formas de pago usa los datos guardados del estudio en studio_defaults, salvo una excepción explícita en details; cada excepción sustituye sólo ese dato. No exijas repetir en el taller los datos habituales del estudio. Nunca tomes el precio de una clase o paquete regular si falta el precio del taller. Para otras políticas del estudio consulta get_policy_information. Sólo devuelve información publicada desde el inicio de promoción hasta el cierre de inscripción inclusive, o hasta el último día del evento si no hay cierre. Si no hay evento vigente, no lo ofrezcas; si falta un dato en ambas fuentes, reconoce el faltante. Explicar cómo pagar no autoriza preparar cobros, compras ni reservas. Para horarios semanales usa search_class_availability. No envía promociones proactivas.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Tema o nombre que preguntó la persona, como 'taller de aro', 'horario' o 'promoción de flexibilidad'.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_studio_information",
    description:
      "Consulta las disciplinas activas, preparación oficial para la primera clase, nombre, sede, domicilio, teléfono, correo y página web configurados. Úsala siempre al preguntar disciplinas o preparación, ubicación o contacto. active_disciplines define la oferta, aunque falten horarios. Si falta la preparación o el dato solicitado, reconoce el faltante y ejecuta escalate_to_human con human_requested para que el equipo responda la consulta; no inventes indicaciones.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_policy_information",
    description:
      "Consulta las políticas operativas reales de cancelación, cancelación tardía y no-show configuradas en Studio Flow.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_student_package_status",
    description:
      "Consulta el paquete activo real de la persona identificada, sus créditos disponibles y su vigencia. Úsala cuando pregunte cuántas clases le quedan, saldo de clases, paquete actual, vigencia o fecha de vencimiento. No inventes créditos ni escales a atención humana sin intentar esta consulta.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_student_reservations",
    description:
      "Consulta las próximas reservas activas de la persona identificada en esta conversación. Úsala antes de cancelar o reagendar para localizar la reserva exacta. No inventes reservas.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

export type PrepareBookingArgs = {
  session_ref: string;
};

export type ExecuteBookingArgs = EmptyArgs;

export type PrepareCancellationArgs = {
  reservation_ref: string;
  reason: string;
};

export type ExecuteCancellationArgs = EmptyArgs;

export type PrepareRescheduleArgs = { reservation_ref: string; target_session_ref: string };
export type ExecuteRescheduleArgs = EmptyArgs;

export type SelectResourceOptionArgs = {
  option_number: number;
};

export type PrepareWaitlistJoinArgs = {
  session_ref: string;
};

export type PrepareBankTransferPurchaseArgs = {
  session_ref: string | null;
  product_ref: string;
  /** D-PAY-03: the person accepted paying the required enrollment together with the package. */
  enrollment_accepted?: boolean | null;
};

export type CompletePurchaseProfileArgs = {
  full_name: string;
  birth_date: string;
  email: string;
};

export type PrepareTransferPackageChoiceArgs = {
  session_ref: string | null;
  product_refs: string[];
};

export type ExecuteWaitlistJoinArgs = EmptyArgs;

export type RecordTrialPaymentPreferenceArgs = {
  payment_method: "cash" | "bank_transfer";
};

export type PrepareStudentAccessActivationArgs = EmptyArgs;

export const assistantActionToolDefinitions: AssistantToolDefinition[] = [
  {
    type: "function",
    name: "record_workshop_continuation",
    strict: true,
    description:
      "Registra la respuesta explícita a una pregunta de continuidad del taller ya entregada por Demi. Consulta antes get_workshop_purchases y usa su referencia exacta. continue conserva reservas y seguimiento de saldo. withdraw exige que el mensaje actual diga «me retiro del taller» o «no quiero continuar con el taller»; un no aislado no basta. Libera solo reservas futuras de esa compra y conserva pagos, deuda y fechas pasadas. No devuelve dinero.",
    parameters: {
      type: "object",
      properties: {
        purchase_ref: { type: "string" },
        decision: { type: "string", enum: ["continue", "withdraw"] },
      },
      required: ["purchase_ref", "decision"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_workshop_purchase",
    strict: true,
    description:
      "Prepara una cotización de taller para la alumna identificada. Usa únicamente referencias de get_workshop_options, todas las fechas para full o las elegidas para sessions. Devuelve condiciones, anticipo y saldo: léelos y pide aceptación explícita en OTRO turno antes de confirmar. No cobra ni reserva ni solicita pagar todavía.",
    parameters: {
      type: "object",
      properties: {
        workshop_ref: { type: "string" },
        session_refs: { type: "array", items: { type: "string" } },
        purchase_mode: { type: "string", enum: ["full", "sessions"] },
      },
      required: ["workshop_ref", "session_refs", "purchase_mode"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "confirm_workshop_purchase",
    strict: true,
    description:
      "Confirma exclusivamente la cotización pendiente cuando la alumna acaba de aceptar explícitamente sus condiciones en otro turno. Devuelve instrucciones bancarias y pide comprobante. No confirma pago ni retiene cupos; el comprobante posterior permite un apartado provisional sujeto a revisión autorizada.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "prepare_enrollment_payment",
    strict: true,
    description:
      "Prepara inscripción o renovación para la alumna identificada, sin comprar otro paquete ni reservar clase. Requiere prueba asistida o alumna regular. Consulta primero inscripción y paquete. Para bank_transfer devuelve precio oficial y cuenta Bancomer: comprobante y revisión manual antes de activar. Para app devuelve acceso al checkout del portal sólo si está habilitado; el interés o enlace no activa derechos. Conserva créditos y vencimiento del paquete existente.",
    parameters: {
      type: "object",
      properties: { payment_method: { type: "string", enum: ["bank_transfer", "app"] } },
      required: ["payment_method"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "identify_meta_contact",
    strict: true,
    description:
      "Busca la identidad de una cuenta de Facebook/Instagram aún no vinculada usando sólo su celular. Antes de ofrecer pagos cuando quiera reservar, pide únicamente diez dígitos; acepta también +52 sin volver a pedir lada. No pide nombre completo ni datos de reserva. Un teléfono escrito no autentica una ficha existente: si requiere verificación, informa el caso humano real, sin divulgar nombres, paquetes ni saldos. Una búsqueda sin coincidencia permite seguir como prospecto; no crea alumna ni reserva.",
    parameters: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_student_access_activation",
    strict: true,
    description:
      "Prepara activar o reenviar el acceso de la alumna identificada después de una asistencia real. Comprueba identidad y estado de cuenta; nunca solicita contraseña ni correo nuevo. Si requiere confirmación, pregunta una sola vez antes de ejecutar en otro turno.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "execute_student_access_activation",
    strict: true,
    description:
      "Tras una nueva confirmación explícita, ejecuta la activación preparada para la misma alumna y conversación. Devuelve su enlace seguro para elegir contraseña; no crea ni cobra inscripción.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "prepare_cash_package_purchase",
    strict: true,
    description:
      "Prepara compra de paquete en efectivo para una alumna regular identificada. Usa product_ref real consultada. Explica el precio, deuda pendiente y que se permite una primera reserva; una segunda requiere cobrar el adeudo. La vigencia inicia en la primera clase reservada. Pide confirmación explícita antes de crear venta o créditos.",
    parameters: {
      type: "object",
      properties: {
        product_ref: { type: "string" },
        payment_due_on: {
          type: ["string", "null"],
          description:
            "Fecha prometida de pago YYYY-MM-DD en la zona horaria del estudio. Usa null si no la indicó; no inventes una fecha. Convierte lunes, mañana u otra fecha relativa usando la fecha local actual.",
        },
      },
      required: ["product_ref", "payment_due_on"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "confirm_cash_package_purchase",
    strict: true,
    description:
      "Confirma la compra en efectivo preparada en un turno anterior tras un sí explícito. Registra deuda y paquete; nunca registra efectivo recibido. No usar para pruebas ni prospectos.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "update_contact_followup",
    strict: true,
    description:
      "Persiste etapa CRM y seguimientos de un prospecto o prueba. No clasifica exige rechazo o incompatibilidad explícitos y un motivo; el silencio usa not_booked tras dos seguimientos, nunca not_qualified. opt_out conserva la preferencia de no enviar recuperación ni promociones. No inventes que se programó o actualizó si la herramienta falla.",
    parameters: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: [
            "answering_questions",
            "awaiting_receipt",
            "awaiting_participant_data",
            "not_booked",
            "not_qualified",
            "opt_out",
          ],
        },
        reason: { type: ["string", "null"] },
      },
      required: ["stage", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_first_class_payment",
    strict: true,
    description:
      "Sólo para la primera clase de quien conversa y también asistirá (recipient_mode=self). Si paga para otra persona (recipient_mode=other), usa prepare_group_booking con participant_count=1; no asocies al pagador como participante. Obtiene el precio y los métodos oficiales para la primera clase de un prospecto sin ficha de alumna: transferencia/depósito a Bancomer o liga individual de Mercado Pago cuando está habilitada. Usa la clase exacta disponible. Sólo prepara el pago: no crea alumna ni reserva, no requiere confirmar una reserva ni elegir paquete. Devuelve group_id: espera comprobante bancario o payment_verified=true de Mercado Pago y después completa con los datos faltantes de un único participante. Si automatic_verification=true y receipt_required=false, no solicites comprobante. Si exige recurso, ofrece las opciones devueltas y vuelve a llamar con el recurso elegido.",
    parameters: {
      type: "object",
      properties: {
        session_ref: { type: "string" },
        resource_ref: { type: ["string", "null"] },
        recipient_mode: { type: "string", enum: ["self", "other"] },
      },
      required: ["session_ref", "resource_ref", "recipient_mode"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_group_booking",
    strict: true,
    description:
      "Prepara el total de una reserva grupal o de una reserva sólo para otra persona (participant_count=1). El pagador que no asiste no es participante ni adquiere prueba. Dos participantes con el mismo teléfono requieren atención humana antes de cobrar o registrar; no prometas unicidad por nombre ni inventes teléfonos. Antes del comprobante bancario o pago Mercado Pago verificado solicita sólo clase, número de participantes y cuántas pagarán primera clase; no pidas nombres ni celulares. Las alumnas con créditos se validan individualmente después. No crea reservas ni retiene cupo. Devuelve group_id y datos bancarios o external_checkout. Si automatic_verification=true y receipt_required=false, espera confirmación del proveedor sin pedir comprobante.",
    parameters: {
      type: "object",
      properties: {
        session_ref: { type: "string" },
        participant_count: { type: "integer" },
        transfer_count: { type: "integer" },
      },
      required: ["session_ref", "participant_count", "transfer_count"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "complete_group_booking",
    strict: true,
    description:
      "Después de comprobante bancario aceptado o payment_verified=true de Mercado Pago, completa el group_id con nombre y teléfono de cada participante juntos. Usa cadenas vacías para datos faltantes, sin inventarlos. resource_ref=null inicialmente: si devuelve group_resource_selection_required, muestra los resource_options con sus etiquetas y disponibilidad y pregunta qué pole elige cada participante. Conserva los datos ya recibidos y vuelve a llamar con resource_ref de cada elección; no elijas por la persona ni escales ese paso normal. No solicites poles antes del comprobante. Crea reservas individuales con cupo y elegibilidad reales; transferencia provisional sujeta a revisión y pago verificado sin revisión manual. El pagador no se convierte automáticamente en participante. En grupos mixtos, la transferencia pendiente no afecta la reserva cubierta por créditos propios. Reporta cada resultado y cualquier importe no asignado; no confirma todo ante un fallo parcial. Si human_review_created=true, informa la canalización real al equipo. Una prueba con reserva pendiente requiere cambiar/cancelar la existente.",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "string" },
        participants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              phone: { type: "string", description: "Diez dígitos mexicanos, sin lada." },
              resource_ref: {
                type: ["string", "null"],
                description:
                  "Pole elegido para esta persona, de resource_options; null si aún no se eligió o no se requiere.",
              },
            },
            required: ["name", "phone", "resource_ref"],
            additionalProperties: false,
          },
        },
      },
      required: ["group_id", "participants"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_booking",
    description:
      "Prepara una reserva para una clase exacta previamente encontrada en Studio Flow. Valida elegibilidad real y devuelve un resumen que debe confirmarse. No ejecuta la reserva.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        session_ref: {
          type: "string",
          description:
            "Referencia opaca de la clase devuelta por search_class_availability, con formato session:<uuid>.",
        },
      },
      required: ["session_ref"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "execute_booking",
    description:
      "Ejecuta la última reserva pendiente de esta conversación. Solo úsala después de un NUEVO mensaje de la persona que confirme explícitamente la reserva. El servidor decide qué acción pendiente puede ejecutarse.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_cancellation",
    description:
      "Cancela directamente una reserva si está dentro del tiempo permitido. Si la cancelación es tardía, calcula la consecuencia real y devuelve confirmation_required para pedir confirmación antes de ejecutar. Requiere un motivo expresado por la persona y nunca lo inventa.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reservation_ref: {
          type: "string",
          description: "Referencia opaca reservation:<uuid> devuelta por get_student_reservations.",
        },
        reason: {
          type: "string",
          description:
            "Motivo de cancelación expresado por la persona. No lo inventes ni lo completes por tu cuenta.",
        },
      },
      required: ["reservation_ref", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "execute_cancellation",
    description:
      "Ejecuta la última cancelación tardía pendiente de esta conversación. Úsala solo después de un NUEVO mensaje con confirmación explícita, porque esa cancelación tiene una consecuencia no recuperable. El servidor vuelve a validar la consecuencia antes de cancelar.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_reschedule",
    description:
      "Prepara mover una reserva existente a una clase destino exacta. Valida la reserva actual, la clase destino y las consecuencias de crédito. No modifica nada todavía.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reservation_ref: { type: "string" },
        target_session_ref: { type: "string" },
      },
      required: ["reservation_ref", "target_session_ref"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "execute_reschedule",
    description:
      "Ejecuta el último reagendado pendiente de esta conversación dentro de una sola transacción. Solo úsala después de un NUEVO mensaje con confirmación explícita.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "select_resource_option",
    description:
      "Selecciona por número uno de los recursos disponibles que Demi acaba de mostrar para la reserva o reagendado pendiente. Úsala cuando la persona responda con 1, 2, 3, etc. Después devuelve el resumen final para pedir confirmación; no ejecuta todavía la reserva.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        option_number: {
          type: "integer",
          minimum: 1,
          description:
            "Número de la opción de recurso elegido por la persona, exactamente como se mostró en el mensaje anterior.",
        },
      },
      required: ["option_number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_waitlist_join",
    description:
      "Prepara el ingreso a la lista de espera de una clase llena. Valida que la clase realmente esté llena, que la persona sea elegible y que no esté ya en la lista. No modifica nada todavía.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        session_ref: {
          type: "string",
          description: "Referencia opaca session:<uuid> devuelta por search_class_availability.",
        },
      },
      required: ["session_ref"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "execute_waitlist_join",
    description:
      "Ejecuta el último ingreso pendiente a lista de espera de esta conversación. Solo úsala después de un NUEVO mensaje con confirmación explícita.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_transfer_package_choice",
    description:
      "Guarda de forma persistente que la persona eligió transferencia y está eligiendo un paquete. Puede usarse con una clase concreta o para comprar el paquete sin reservar todavía. Llámala ANTES de mostrar la lista de paquetes y preguntar cuál prefiere. Pasa exactamente los product_ref de las opciones que vas a mostrar.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        session_ref: {
          type: ["string", "null"],
          description:
            "Referencia session:<uuid> de la clase objetivo cuando exista; null si la persona solo quiere comprar el paquete.",
        },
        product_refs: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: { type: "string" },
          description:
            "Referencias product:<uuid> exactas de los paquetes compatibles que se mostrarán a la persona.",
        },
      },
      required: ["session_ref", "product_refs"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_bank_transfer_purchase",
    description:
      "Prepara una compra por transferencia después de que la persona eligió un paquete concreto. Puede vincularse a una clase o hacerse sin reservar ninguna clase. Si el paquete requiere inscripción y la persona no la tiene vigente, la primera llamada con enrollment_accepted=false no crea nada y devuelve enrollment_confirmation_required con paquete, inscripción y total: explícalo y, sólo si acepta, vuelve a llamar con enrollment_accepted=true para cobrar inscripción y paquete en una sola transferencia. Si el paquete incluye inscripción no hay cargo adicional. Guarda la intención pendiente y devuelve monto total y datos bancarios reales. No activa créditos todavía; la activación provisional ocurre cuando llega un comprobante cuyo monto coincide.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        session_ref: {
          type: ["string", "null"],
          description:
            "Referencia session:<uuid> de la clase objetivo; null si la compra no está ligada a una clase.",
        },
        product_ref: {
          type: "string",
          description:
            "Referencia product:<uuid> exacta del paquete seleccionado de get_commercial_options.",
        },
        enrollment_accepted: {
          type: "boolean",
          description:
            "true sólo si la persona ya aceptó pagar la inscripción requerida junto con el paquete después de conocer el total.",
        },
      },
      required: ["session_ref", "product_ref", "enrollment_accepted"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "escalate_to_human",
    description:
      "Pasa esta conversación a atención humana dentro del mismo canal cuando un pago o comprobante necesita revisión manual, cuando la persona lo pide o cuando Demi no puede resolver el caso con seguridad.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reason_code: {
          type: "string",
          enum: [
            "transfer_receipt_review",
            "payment_validation",
            "human_requested",
            "refund_request",
            "payment_dispute",
            "safety_incident",
            "serious_complaint",
            "technical_block",
            "policy_exception",
            "package_cancellation",
            "receipt_validation_failed",
            "user_requested_human",
            "assistant_cannot_resolve",
          ],
        },
        note: {
          type: ["string", "null"],
          description:
            "Resumen breve y seguro para la persona que dará seguimiento. No incluyas secretos ni datos bancarios completos.",
        },
      },
      required: ["reason_code", "note"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "complete_purchase_profile",
    description:
      "Sólo para un prospecto cuya compra de paquete por transferencia ya tiene comprobante con monto coincidente (estado awaiting_profile). Registra nombre completo, fecha de nacimiento y correo, crea su ficha de alumna y activa inscripción y paquete provisionalmente. Nunca la uses antes del comprobante.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        full_name: {
          type: "string",
          description: "Nombre y apellidos tal como los dio la persona.",
        },
        birth_date: { type: "string", description: "Fecha de nacimiento en formato YYYY-MM-DD." },
        email: { type: "string", description: "Correo electrónico de la persona." },
      },
      required: ["full_name", "birth_date", "email"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "record_trial_payment_preference",
    description:
      "Registra cómo piensa pagar una persona su clase de prueba ya reservada: efectivo en el estudio o transferencia. Esto NO registra un pago recibido y no debe marcar la reserva como pagada.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        payment_method: {
          type: "string",
          enum: ["cash", "bank_transfer"],
          description: "cash para efectivo en el estudio; bank_transfer para transferencia.",
        },
      },
      required: ["payment_method"],
      additionalProperties: false,
    },
  },
];

export const assistantReadToolNames = new Set(
  assistantReadToolDefinitions.map((tool) => tool.name),
);

export const assistantActionToolNames = new Set(
  assistantActionToolDefinitions.map((tool) => tool.name),
);
