export type AutomationCategory =
  "operation" | "team" | "administration" | "conversion" | "retention";

export type AutomationPriority = "P0" | "P1" | "P2" | "P3";
export type RequiredActionCatalogPriority = "high" | "medium" | "dynamic";

export type AutomationRecipient =
  "student" | "student_or_prospect" | "former_student" | "coach" | "administration" | "reception";

export type AutomationTriggerKind = "event" | "scheduled" | "condition" | "sequence";

export type AutomationConfigurationMode = "single" | "multiple" | "system_managed";

export type AutomationFrequencyMode =
  "once_per_source" | "per_configuration_per_source" | "incident_deduped" | "sequence_controlled";

export type AutomationOutputKind =
  | "whatsapp_student"
  | "internal_summary"
  | "required_action"
  | "required_action_and_internal_notification"
  | "sequence_communication";

export type AutomationCatalogCode =
  | "AUT-CAT-01"
  | "AUT-CAT-02"
  | "AUT-CAT-03"
  | "AUT-CAT-04"
  | "AUT-CAT-05"
  | "AUT-CAT-06"
  | "AUT-CAT-07"
  | "AUT-CAT-08"
  | "AUT-CAT-09"
  | "AUT-CAT-10"
  | "AUT-CAT-11"
  | "AUT-CAT-12"
  | "AUT-CAT-13"
  | "AUT-CAT-14"
  | "AUT-CAT-15"
  | "AUT-CAT-16";

export type AutomationSequenceCode = "SEC-01" | "SEC-02" | "SEC-03";

export interface AutomationPriorityPolicy {
  /**
   * AUT-05 applies to communications to students/prospects.
   * Internal team/admin automations intentionally keep this null because
   * internal communications and Required Action severity are separate policies.
   */
  communication: AutomationPriority | null;
  promotionalOverride?: AutomationPriority;
  requiredAction?: RequiredActionCatalogPriority;
  scope: "aut05" | "internal";
}

export interface AutomationTemplate {
  code: AutomationCatalogCode;
  key: string;
  name: string;
  category: AutomationCategory;
  description: string;
  priority: AutomationPriorityPolicy;
  recipients: readonly AutomationRecipient[];
  trigger: {
    kind: AutomationTriggerKind;
    description: string;
  };
  protectedConditions: readonly string[];
  configurableParameters: readonly string[];
  variables: readonly string[];
  frequency: {
    mode: AutomationFrequencyMode;
    description: string;
  };
  configurationMode: AutomationConfigurationMode;
  output: {
    kind: AutomationOutputKind;
    description: string;
  };
  sequenceIds: readonly AutomationSequenceCode[];
  requirements: readonly string[];
}

export interface AutomationSequenceDefinition {
  code: AutomationSequenceCode;
  key: string;
  name: string;
  objective: string;
  memberCodes: readonly AutomationCatalogCode[];
  steps: readonly string[];
}

export type AutomationDominanceTarget =
  | { kind: "automation"; code: AutomationCatalogCode }
  | { kind: "priority"; priorities: readonly AutomationPriority[] }
  | { kind: "external"; key: string };

export interface AutomationDominanceRule {
  source: { kind: "automation"; code: AutomationCatalogCode } | { kind: "context"; key: string };
  target: AutomationDominanceTarget;
  effect: "dominates" | "suppresses";
  reason: string;
}

export const AUTOMATION_CATALOG_VERSION = 1;

export const AUTOMATION_CATALOG = [
  {
    code: "AUT-CAT-01",
    key: "reservation_confirmed",
    name: "Reserva confirmada",
    category: "operation",
    description: "Confirma una reserva creada correctamente.",
    priority: { communication: "P1", scope: "aut05" },
    recipients: ["student"],
    trigger: { kind: "event", description: "Reserva creada correctamente." },
    protectedConditions: [
      "Reserva válida y confirmada.",
      "Alumna identificada.",
      "Canal de contacto disponible al momento de ejecutar.",
    ],
    configurableParameters: [],
    variables: [
      "nombre",
      "disciplina",
      "fecha",
      "hora",
      "coach",
      "ubicacion",
      "creditos_restantes",
    ],
    frequency: {
      mode: "once_per_source",
      description: "Una ejecución por reserva confirmada.",
    },
    configurationMode: "single",
    output: {
      kind: "whatsapp_student",
      description: "Confirmación de que el lugar quedó reservado.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-02",
    key: "reservation_cancelled",
    name: "Reserva cancelada",
    category: "operation",
    description: "Comunica una cancelación finalizada y sus consecuencias.",
    priority: { communication: "P1", scope: "aut05" },
    recipients: ["student"],
    trigger: { kind: "event", description: "Cancelación de reserva finalizada." },
    protectedConditions: ["La cancelación debe estar efectivamente finalizada."],
    configurableParameters: [],
    variables: [
      "clase",
      "fecha",
      "hora",
      "tipo_cancelacion",
      "credito_recuperado",
      "creditos_restantes",
    ],
    frequency: {
      mode: "once_per_source",
      description: "Una ejecución por cancelación finalizada.",
    },
    configurationMode: "single",
    output: {
      kind: "whatsapp_student",
      description: "Confirmación de cancelación y consecuencias aplicadas.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-03",
    key: "reservation_rescheduled",
    name: "Reserva reprogramada",
    category: "operation",
    description: "Informa el nuevo horario confirmado de una reprogramación.",
    priority: { communication: "P1", scope: "aut05" },
    recipients: ["student"],
    trigger: {
      kind: "event",
      description: "La nueva reserva de la reprogramación quedó confirmada.",
    },
    protectedConditions: ["No comunicar hasta que la nueva reserva esté confirmada."],
    configurableParameters: [],
    variables: ["clase_anterior", "nuevo_dia", "nueva_hora", "coach"],
    frequency: {
      mode: "once_per_source",
      description: "Una ejecución por reprogramación confirmada.",
    },
    configurationMode: "single",
    output: {
      kind: "whatsapp_student",
      description: "Comunicación del nuevo horario confirmado.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-04",
    key: "class_reminder",
    name: "Recordatorio de clase",
    category: "operation",
    description: "Recuerda próximas reservas.",
    priority: { communication: "P1", scope: "aut05" },
    recipients: ["student"],
    trigger: {
      kind: "scheduled",
      description: "X tiempo antes de una reserva futura.",
    },
    protectedConditions: [
      "Reserva activa.",
      "Clase no cancelada.",
      "Alumna todavía inscrita en la reserva.",
      "Revalidar antes de enviar.",
    ],
    configurableParameters: ["lead_time", "message_template", "send_window"],
    variables: [],
    frequency: {
      mode: "per_configuration_per_source",
      description:
        "Permite múltiples configuraciones; 24 h, 12 h, 2 h o un tiempo permitido configurado.",
    },
    configurationMode: "multiple",
    output: {
      kind: "whatsapp_student",
      description: "Recordatorio de la próxima clase.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-05",
    key: "payment_confirmed",
    name: "Pago confirmado",
    category: "operation",
    description: "Confirma un pago realizado.",
    priority: { communication: "P1", scope: "aut05" },
    recipients: ["student"],
    trigger: { kind: "event", description: "Pago confirmado en Studio Flow." },
    protectedConditions: [
      "No ejecutar por pago iniciado o pendiente.",
      "Los efectos comerciales del pago deben permanecer idempotentes.",
    ],
    configurableParameters: [],
    variables: ["monto", "concepto", "metodo", "paquete", "saldo_pendiente"],
    frequency: {
      mode: "once_per_source",
      description: "Una ejecución por operación de pago confirmada.",
    },
    configurationMode: "single",
    output: {
      kind: "whatsapp_student",
      description: "Confirmación del pago acreditado.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-06",
    key: "package_activated",
    name: "Paquete activado",
    category: "operation",
    description: "Confirma que un paquete pasó a estado activo.",
    priority: { communication: "P1", scope: "aut05" },
    recipients: ["student"],
    trigger: { kind: "event", description: "El paquete pasa realmente a estado activo." },
    protectedConditions: ["Debe existir una activación real del paquete."],
    configurableParameters: [],
    variables: ["paquete", "creditos", "fecha_inicio", "fecha_vencimiento"],
    frequency: {
      mode: "once_per_source",
      description: "Una ejecución por activación real del paquete.",
    },
    configurationMode: "single",
    output: {
      kind: "whatsapp_student",
      description: "Confirmación de activación; puede combinarse con Pago confirmado.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-07",
    key: "coach_preclass_summary",
    name: "Resumen previo al coach",
    category: "team",
    description: "Entrega al coach un resumen operativo antes de su clase.",
    priority: { communication: null, scope: "internal" },
    recipients: ["coach"],
    trigger: { kind: "scheduled", description: "X tiempo antes de una clase asignada." },
    protectedConditions: ["Clase activa.", "Coach asignado a esa clase."],
    configurableParameters: ["lead_time"],
    variables: ["clase", "hora", "reservadas", "cupo", "alumnas", "alertas"],
    frequency: {
      mode: "per_configuration_per_source",
      description: "Una vez por clase para la anticipación configurada.",
    },
    configurationMode: "single",
    output: {
      kind: "internal_summary",
      description: "Resumen interno para el coach; no usa preferencias comerciales de alumnas.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-08",
    key: "class_close_incidents",
    name: "Incidencias al cerrar clase",
    category: "administration",
    description: "Analiza el cierre de asistencia y genera intervención sólo si existe incidencia.",
    priority: { communication: null, requiredAction: "dynamic", scope: "internal" },
    recipients: ["administration"],
    trigger: { kind: "event", description: "Finalización de la asistencia de una clase." },
    protectedConditions: [
      "Analizar reservas, asistencias, no-shows, walk-ins y contexto de pago.",
      "Si todo está correcto, no crear acción.",
      "Si existe pendiente, deduplicar la incidencia abierta.",
    ],
    configurableParameters: [],
    variables: [],
    frequency: {
      mode: "incident_deduped",
      description: "Una acción abierta por incidencia; no repetir mientras siga sin cambios.",
    },
    configurationMode: "system_managed",
    output: {
      kind: "required_action_and_internal_notification",
      description: "Acción requerida y aviso interno a administración cuando corresponda.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-09",
    key: "walkin_unpaid",
    name: "Walk-in sin pago",
    category: "administration",
    description: "Escala un walk-in sin cobertura financiera aplicable.",
    priority: { communication: null, requiredAction: "high", scope: "internal" },
    recipients: ["administration", "reception"],
    trigger: { kind: "event", description: "Walk-in registrado." },
    protectedConditions: ["Sin paquete, crédito o pago aplicable para cubrir la asistencia."],
    configurableParameters: [],
    variables: [],
    frequency: {
      mode: "incident_deduped",
      description: "Una incidencia abierta por walk-in; deduplicada hasta su resolución.",
    },
    configurationMode: "system_managed",
    output: {
      kind: "required_action_and_internal_notification",
      description:
        "Acción requerida de prioridad alta; se cierra al registrar pago, paquete, cortesía o resolución documentada.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-10",
    key: "attendance_without_reservation",
    name: "Asistencia sin reserva",
    category: "administration",
    description: "Detecta una asistencia registrada sin una reserva previa.",
    priority: { communication: null, requiredAction: "medium", scope: "internal" },
    recipients: ["administration"],
    trigger: { kind: "event", description: "Asistencia registrada sin reserva existente." },
    protectedConditions: [
      "Studio Flow intenta resolver primero el caso con su lógica operativa.",
      "Sólo crear Acción requerida si queda una intervención humana pendiente.",
    ],
    configurableParameters: [],
    variables: [],
    frequency: {
      mode: "incident_deduped",
      description: "No repetir la misma incidencia mientras permanezca abierta.",
    },
    configurationMode: "system_managed",
    output: {
      kind: "required_action",
      description: "Acción requerida sólo cuando el caso no puede resolverse automáticamente.",
    },
    sequenceIds: [],
    requirements: [],
  },
  {
    code: "AUT-CAT-11",
    key: "first_class_follow_up",
    name: "Seguimiento de primera clase",
    category: "conversion",
    description: "Da seguimiento a la primera experiencia después de la asistencia.",
    priority: { communication: "P2", scope: "aut05" },
    recipients: ["student_or_prospect"],
    trigger: { kind: "event", description: "Primera asistencia completada." },
    protectedConditions: ["Debe corresponder a la primera experiencia completada."],
    configurableParameters: [],
    variables: ["nombre", "clase", "coach", "fecha"],
    frequency: {
      mode: "sequence_controlled",
      description: "Instancia única por primera experiencia.",
    },
    configurationMode: "single",
    output: {
      kind: "sequence_communication",
      description: "Seguimiento postclase dentro de la secuencia Primera clase.",
    },
    sequenceIds: ["SEC-01"],
    requirements: [],
  },
  {
    code: "AUT-CAT-12",
    key: "first_class_no_purchase",
    name: "Primera clase sin compra",
    category: "conversion",
    description: "Continúa la secuencia si después de la primera clase aún no existe compra.",
    priority: { communication: "P2", promotionalOverride: "P3", scope: "aut05" },
    recipients: ["student_or_prospect"],
    trigger: {
      kind: "sequence",
      description: "Después del seguimiento inicial y una espera configurable.",
    },
    protectedConditions: [
      "La persona continúa sin compra al momento de revalidar.",
      "Una compra termina la secuencia y evita el envío.",
    ],
    configurableParameters: ["wait_duration"],
    variables: [],
    frequency: {
      mode: "sequence_controlled",
      description: "Una vez dentro de la secuencia de primera clase.",
    },
    configurationMode: "single",
    output: {
      kind: "sequence_communication",
      description:
        "Seguimiento de conversión; si incorpora una promoción se trata como comunicación P3.",
    },
    sequenceIds: ["SEC-01"],
    requirements: [],
  },
  {
    code: "AUT-CAT-13",
    key: "package_expiring",
    name: "Paquete por vencer",
    category: "retention",
    description: "Ayuda a aprovechar créditos antes del vencimiento.",
    priority: { communication: "P2", scope: "aut05" },
    recipients: ["student"],
    trigger: {
      kind: "scheduled",
      description: "X días antes del vencimiento del paquete.",
    },
    protectedConditions: [
      "Paquete activo.",
      "Créditos restantes.",
      "Sin renovación que vuelva irrelevante el mensaje.",
      "Revalidar elegibilidad antes del envío.",
    ],
    configurableParameters: [
      "days_before_expiration",
      "message_template",
      "send_window",
      "optional_filters",
      "allowed_frequency",
    ],
    variables: ["nombre", "creditos_restantes", "fecha_vencimiento"],
    frequency: {
      mode: "per_configuration_per_source",
      description: "Múltiples configuraciones permitidas por paquete.",
    },
    configurationMode: "multiple",
    output: {
      kind: "whatsapp_student",
      description: "Comunicación de retención con resultado esperado de reserva o renovación.",
    },
    sequenceIds: ["SEC-02"],
    requirements: [],
  },
  {
    code: "AUT-CAT-14",
    key: "student_inactive",
    name: "Alumna inactiva",
    category: "retention",
    description: "Busca recuperar a una alumna según su patrón de asistencia.",
    priority: { communication: "P2", scope: "aut05" },
    recipients: ["student"],
    trigger: {
      kind: "condition",
      description: "X días desde la última asistencia.",
    },
    protectedConditions: [
      "Sin próxima reserva.",
      "Elegible para comunicaciones de retención.",
      "Una reserva futura suprime esta comunicación.",
    ],
    configurableParameters: ["inactivity_days"],
    variables: [],
    frequency: {
      mode: "sequence_controlled",
      description: "Se controla por episodio de inactividad y se revalida antes de comunicar.",
    },
    configurationMode: "single",
    output: {
      kind: "sequence_communication",
      description: "Mensaje de retorno con resultado esperado de nueva reserva y regreso efectivo.",
    },
    sequenceIds: ["SEC-03"],
    requirements: [],
  },
  {
    code: "AUT-CAT-15",
    key: "package_recently_expired",
    name: "Paquete vencido reciente",
    category: "retention",
    description: "Da continuidad al ciclo cuando un paquete venció y no hubo renovación.",
    priority: { communication: "P2", scope: "aut05" },
    recipients: ["student"],
    trigger: {
      kind: "condition",
      description: "El paquete venció hace X tiempo.",
    },
    protectedConditions: [
      "Sin paquete nuevo.",
      "Sin renovación.",
      "Elegible para comunicaciones de retención.",
    ],
    configurableParameters: ["elapsed_since_expiration"],
    variables: [],
    frequency: {
      mode: "sequence_controlled",
      description: "Se ejecuta dentro de la secuencia de paquete después de no renovar.",
    },
    configurationMode: "single",
    output: {
      kind: "sequence_communication",
      description: "Seguimiento posterior al vencimiento dentro de la secuencia de paquete.",
    },
    sequenceIds: ["SEC-02"],
    requirements: [],
  },
  {
    code: "AUT-CAT-16",
    key: "expired_package_recovery",
    name: "Recuperación de paquete vencido",
    category: "retention",
    description: "Comunica una recuperación permitida sobre un paquete vencido.",
    priority: { communication: "P3", scope: "aut05" },
    recipients: ["former_student"],
    trigger: {
      kind: "sequence",
      description: "Paquete vencido y existe una promoción o regla de recuperación aplicable.",
    },
    protectedConditions: [
      "Studio Flow calcula la elegibilidad.",
      "El beneficio, precio y vigencia provienen de una promoción válida de Studio Flow.",
      "No inventar promociones ni beneficios.",
    ],
    configurableParameters: [],
    variables: ["paquete_anterior", "creditos_vencidos", "beneficio_permitido", "fecha_limite"],
    frequency: {
      mode: "sequence_controlled",
      description:
        "Sólo cuando la secuencia de paquete llega a recuperación y sigue siendo elegible.",
    },
    configurationMode: "single",
    output: {
      kind: "whatsapp_student",
      description: "Comunicación comercial de recuperación.",
    },
    sequenceIds: ["SEC-02"],
    requirements: [
      "messaging_provider_available",
      "recipient_whatsapp_available",
      "active_recovery_promotion",
    ],
  },
] as const satisfies readonly AutomationTemplate[];

export const AUTOMATION_SEQUENCES = [
  {
    code: "SEC-01",
    key: "first_class",
    name: "Primera clase",
    objective: "Convertir una primera experiencia en una alumna activa.",
    memberCodes: ["AUT-CAT-11", "AUT-CAT-12"],
    steps: [
      "Primera clase completada.",
      "Seguimiento de primera clase.",
      "Esperar X tiempo.",
      "Revalidar si compró paquete.",
      "Si compró: finalizar.",
      "Si no compró: Primera clase sin compra.",
    ],
  },
  {
    code: "SEC-02",
    key: "package_lifecycle",
    name: "Paquete",
    objective: "Acompañar el ciclo de vida de un paquete.",
    memberCodes: ["AUT-CAT-13", "AUT-CAT-15", "AUT-CAT-16"],
    steps: [
      "Paquete activo.",
      "Paquete por vencer.",
      "Revalidar si renovó.",
      "Si renovó: finalizar.",
      "Si no renovó: Paquete vencido reciente.",
      "Recuperación si aplica.",
    ],
  },
  {
    code: "SEC-03",
    key: "inactivity_recovery",
    name: "Inactividad / recuperación",
    objective: "Reactiva alumnas que han dejado de asistir.",
    memberCodes: ["AUT-CAT-14"],
    steps: [
      "Evaluar patrón de asistencia.",
      "Detectar inactividad.",
      "Revalidar si ya tiene reserva.",
      "Si ya tiene reserva: no comunicar.",
      "Si no tiene reserva: mensaje de retorno.",
      "Finalizar al reservar y regresar; una campaña posterior es un concepto separado.",
    ],
  },
] as const satisfies readonly AutomationSequenceDefinition[];

export const AUTOMATION_DOMINANCE_RULES = [
  {
    source: { kind: "automation", code: "AUT-CAT-13" },
    target: { kind: "automation", code: "AUT-CAT-14" },
    effect: "dominates",
    reason: "Paquete por vencer es más específico que una comunicación genérica de inactividad.",
  },
  {
    source: { kind: "automation", code: "AUT-CAT-12" },
    target: { kind: "external", key: "promotion.general" },
    effect: "dominates",
    reason: "Primera clase sin compra responde a un punto específico del journey.",
  },
  {
    source: { kind: "automation", code: "AUT-CAT-01" },
    target: { kind: "priority", priorities: ["P2", "P3"] },
    effect: "dominates",
    reason: "Las comunicaciones operativas de reserva tienen prioridad sobre P2/P3.",
  },
  {
    source: { kind: "automation", code: "AUT-CAT-05" },
    target: { kind: "priority", priorities: ["P2", "P3"] },
    effect: "dominates",
    reason: "La confirmación operativa de pago prevalece sobre comunicaciones P2/P3.",
  },
  {
    source: { kind: "context", key: "open_payment_incident" },
    target: { kind: "external", key: "promotion.related" },
    effect: "dominates",
    reason: "Primero debe resolverse la situación operativa de pago.",
  },
  {
    source: { kind: "context", key: "future_reservation" },
    target: { kind: "automation", code: "AUT-CAT-14" },
    effect: "suppresses",
    reason: "Si ya existe una reserva futura, no corresponde comunicar inactividad.",
  },
  {
    source: { kind: "automation", code: "AUT-CAT-16" },
    target: { kind: "external", key: "campaign.mass_recovery" },
    effect: "dominates",
    reason: "La recuperación personalizada prevalece sobre una campaña masiva.",
  },
] as const satisfies readonly AutomationDominanceRule[];

export function getAutomationTemplate(code: AutomationCatalogCode): AutomationTemplate {
  const template = AUTOMATION_CATALOG.find((entry) => entry.code === code);
  if (!template) {
    throw new Error(`automation_template_not_found:${code}`);
  }
  return template;
}

export function getAutomationTemplatesByCategory(
  category: AutomationCategory,
): readonly AutomationTemplate[] {
  return AUTOMATION_CATALOG.filter((entry) => entry.category === category);
}
