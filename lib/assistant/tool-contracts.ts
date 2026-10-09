import "server-only";

export type AssistantPermissionClass = "A" | "B" | "C";

export type SearchClassAvailabilityArgs = {
  activity_query: string | null;
  date_from: string;
  date_to: string;
  after_time: string | null;
  before_time: string | null;
  limit: number;
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
    name: "search_class_availability",
    description:
      "Consulta clases reales y lugares disponibles en Studio Flow. Úsala siempre para preguntas de horarios, fechas, 'hoy', 'mañana', horas concretas o disponibilidad. No devuelve precios comerciales; para precios usa get_commercial_options. Nunca inventes una clase. Si la persona nombra una actividad concreta, conserva ese nombre exacto en activity_query; no lo abrevies a una categoría más amplia.",
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
          description: "Fecha final local del estudio en formato YYYY-MM-DD.",
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
      },
      required: ["activity_query", "date_from", "date_to", "after_time", "before_time", "limit"],
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
    name: "get_studio_information",
    description:
      "Consulta el nombre, sede principal, domicilio, teléfono, correo y página web configurados por el estudio. Úsala siempre que pregunten dónde está el estudio, cómo llegar, cuál es su dirección, teléfono, correo, web o datos de contacto. No inventes datos que no estén configurados.",
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
      "Prepara una compra por transferencia después de que la persona eligió un paquete concreto. Puede vincularse a una clase o hacerse sin reservar ninguna clase. Guarda la intención pendiente y devuelve monto y datos bancarios reales. No activa créditos todavía; la activación provisional ocurre cuando llega un comprobante cuyo monto coincide.",
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
      },
      required: ["session_ref", "product_ref"],
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
