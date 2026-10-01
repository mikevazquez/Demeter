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
      "Consulta clases reales y lugares disponibles en Studio Flow. Úsala siempre para preguntas de horarios, fechas, 'hoy', 'mañana', horas concretas o disponibilidad. Nunca inventes una clase.",
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
      required: [
        "activity_query",
        "date_from",
        "date_to",
        "after_time",
        "before_time",
        "limit",
      ],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_activity_catalog",
    description:
      "Consulta las actividades y disciplinas reales configuradas por el estudio, con descripción y precio de clase suelta cuando exista.",
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
      "Consulta paquetes, membresías y precios activos reales de Studio Flow. Úsala para '¿cuánto cuesta?', paquetes o membresías. No inventes promociones.",
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
    name: "get_studio_information",
    description:
      "Consulta nombre, ubicación/dirección y datos públicos de atención del estudio.",
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

export type PrepareWaitlistJoinArgs = {
  session_ref: string;
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
      "Prepara la cancelación de una reserva exacta. Requiere un motivo expresado por la persona, calcula la consecuencia real y pide confirmación. Nunca inventes el motivo.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reservation_ref: {
          type: "string",
          description:
            "Referencia opaca reservation:<uuid> devuelta por get_student_reservations.",
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
      "Ejecuta la última cancelación pendiente de esta conversación. Solo úsala después de un NUEVO mensaje con confirmación explícita. El servidor vuelve a validar la consecuencia antes de cancelar.",
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
    name: "prepare_waitlist_join",
    description:
      "Prepara el ingreso a la lista de espera de una clase llena. Valida que la clase realmente esté llena, que la persona sea elegible y que no esté ya en la lista. No modifica nada todavía.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        session_ref: {
          type: "string",
          description:
            "Referencia opaca session:<uuid> devuelta por search_class_availability.",
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
            "assistant_cannot_resolve"
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
          description:
            "cash para efectivo en el estudio; bank_transfer para transferencia.",
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
