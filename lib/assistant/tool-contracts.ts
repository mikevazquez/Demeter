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
];

export type PrepareBookingArgs = {
  session_ref: string;
};

export type ExecuteBookingArgs = {
  pending_action_ref: string;
};

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
      "Ejecuta una reserva previamente preparada. Solo úsala después de un NUEVO mensaje de la persona que confirme explícitamente la reserva.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        pending_action_ref: {
          type: "string",
          description:
            "Referencia opaca action:<uuid> devuelta por prepare_booking.",
        },
      },
      required: ["pending_action_ref"],
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
