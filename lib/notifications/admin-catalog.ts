export type NotificationChannelKey = "push" | "whatsapp" | "email";
export type NotificationProcessCategory =
  "reservas" | "paquetes" | "evaluaciones" | "documentos" | "cuenta";

export type NotificationProcessDefinition = {
  key: string;
  name: string;
  description: string;
  category: NotificationProcessCategory;
  ruleKeys: readonly string[];
  timingLabel: string;
  recipientLabel: string;
  essential?: boolean;
  planned?: boolean;
};

export const NOTIFICATION_PROCESS_CATEGORIES = [
  { key: "all", label: "Todos" },
  { key: "reservas", label: "Reservas" },
  { key: "paquetes", label: "Paquetes y pagos" },
  { key: "evaluaciones", label: "Evaluaciones" },
  { key: "documentos", label: "Documentos" },
  { key: "cuenta", label: "Cuenta" },
] as const;

export const NOTIFICATION_PROCESSES: readonly NotificationProcessDefinition[] = [
  {
    key: "reservation-confirmed",
    name: "Reserva confirmada",
    description: "Confirma que el lugar quedó reservado.",
    category: "reservas",
    ruleKeys: ["p0.booking.confirmed"],
    timingLabel: "Al reservar una clase · inmediata",
    recipientLabel: "Alumna con reserva confirmada",
  },
  {
    key: "reservation-cancelled",
    name: "Reserva cancelada",
    description: "Confirma la cancelación y sus consecuencias.",
    category: "reservas",
    ruleKeys: ["p0.booking.cancelled"],
    timingLabel: "Al finalizar una cancelación · inmediata",
    recipientLabel: "Alumna de la reserva",
  },
  {
    key: "reservation-rescheduled",
    name: "Reserva modificada",
    description: "Informa cuando cambia el horario de una sesión reservada.",
    category: "reservas",
    ruleKeys: ["p0.session.rescheduled_notice"],
    timingLabel: "Al cambiar el horario · inmediata",
    recipientLabel: "Alumnas con reserva confirmada",
  },
  {
    key: "class-reminder",
    name: "Recordatorio de clase",
    description: "Ayuda a reducir inasistencias antes de la clase.",
    category: "reservas",
    ruleKeys: ["p0.booking.class_reminder_5h", "p0.session.rescheduled_reminder_5h"],
    timingLabel: "Antes de la clase · configurable",
    recipientLabel: "Alumna con reserva confirmada",
  },
  {
    key: "minimum-cancelled",
    name: "Cancelación por mínimo de reservas",
    description: "Avisa a alumnas y coach cuando una clase no alcanza el mínimo.",
    category: "reservas",
    ruleKeys: ["p0.session.minimum_cancelled_students", "p0.session.minimum_cancelled_coach"],
    timingLabel: "Al cancelar la sesión · inmediata",
    recipientLabel: "Alumnas afectadas y coach",
    essential: true,
  },
  {
    key: "waitlist-promoted",
    name: "Lugar disponible en lista de espera",
    description: "Avisa cuando la alumna obtiene un lugar en la clase.",
    category: "reservas",
    ruleKeys: ["p0.booking.waitlist_promoted"],
    timingLabel: "Al obtener un lugar · inmediata",
    recipientLabel: "Alumna promovida desde lista de espera",
  },
  {
    key: "evaluation-invitation",
    name: "Invitación a evaluación",
    description: "Informa cuando hay una evaluación disponible para agendar.",
    category: "evaluaciones",
    ruleKeys: ["p0.evaluation.invitation"],
    timingLabel: "Al emitir la invitación · inmediata",
    recipientLabel: "Alumna invitada",
  },
  {
    key: "evaluation-scheduled",
    name: "Evaluación programada",
    description: "Confirma que la evaluación quedó agendada.",
    category: "evaluaciones",
    ruleKeys: ["p0.evaluation.scheduled"],
    timingLabel: "Al programar · inmediata",
    recipientLabel: "Alumna evaluada",
  },
  {
    key: "evaluation-completed",
    name: "Resultado de evaluación",
    description: "Informa cuando los resultados ya están disponibles.",
    category: "evaluaciones",
    ruleKeys: ["p0.evaluation.completed"],
    timingLabel: "Al cerrar la evaluación · inmediata",
    recipientLabel: "Alumna evaluada",
  },
  {
    key: "late-cancellation",
    name: "Cancelación tardía",
    description: "Explica la pérdida de crédito o penalización aplicada.",
    category: "reservas",
    ruleKeys: [],
    timingLabel: "Al cancelar dentro de la ventana tardía",
    recipientLabel: "Alumna de la reserva",
    planned: true,
  },
  {
    key: "no-show",
    name: "No show",
    description: "Informa el cierre de una reserva sin asistencia.",
    category: "reservas",
    ruleKeys: [],
    timingLabel: "Al finalizar la sesión",
    recipientLabel: "Alumna ausente",
    planned: true,
  },
  {
    key: "waitlist-expired",
    name: "Lugar de lista de espera vencido",
    description: "Informa cuando una oportunidad de reserva deja de estar disponible.",
    category: "reservas",
    ruleKeys: [],
    timingLabel: "Al vencer la oportunidad",
    recipientLabel: "Alumna en lista de espera",
    planned: true,
  },
  {
    key: "package-activated",
    name: "Paquete comprado o activado",
    description: "Confirma la activación de un paquete.",
    category: "paquetes",
    ruleKeys: [],
    timingLabel: "Al activar un paquete · inmediata",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "package-expiring",
    name: "Paquete próximo a vencer",
    description: "Avisa antes del vencimiento para aprovechar créditos.",
    category: "paquetes",
    ruleKeys: [],
    timingLabel: "X días antes del vencimiento",
    recipientLabel: "Alumna con paquete activo",
    planned: true,
  },
  {
    key: "package-expired",
    name: "Paquete vencido",
    description: "Informa el fin de vigencia del paquete.",
    category: "paquetes",
    ruleKeys: [],
    timingLabel: "Al vencer el paquete",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "credit-restored",
    name: "Crédito restaurado",
    description: "Confirma cuando Studio Flow devuelve un crédito.",
    category: "paquetes",
    ruleKeys: [],
    timingLabel: "Al restaurar el crédito · inmediata",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "payment-pending",
    name: "Pago pendiente",
    description: "Solicita completar una operación pendiente.",
    category: "paquetes",
    ruleKeys: [],
    timingLabel: "Cuando queda un pago pendiente",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "payment-confirmed",
    name: "Pago confirmado",
    description: "Confirma que un pago quedó acreditado.",
    category: "paquetes",
    ruleKeys: [],
    timingLabel: "Al confirmar el pago · inmediata",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "evaluation-reminder",
    name: "Recordatorio de evaluación",
    description: "Recuerda una evaluación próxima.",
    category: "evaluaciones",
    ruleKeys: [],
    timingLabel: "Antes de la evaluación",
    recipientLabel: "Alumna evaluada",
    planned: true,
  },
  {
    key: "documents-pending",
    name: "Documentos pendientes",
    description: "Avisa cuando faltan documentos obligatorios por aceptar.",
    category: "documentos",
    ruleKeys: [],
    timingLabel: "Al detectar documentos pendientes",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "document-new-version",
    name: "Nueva versión de documento",
    description: "Avisa cuando un documento obligatorio requiere nueva aceptación.",
    category: "documentos",
    ruleKeys: [],
    timingLabel: "Al activar una nueva versión",
    recipientLabel: "Personas afectadas",
    planned: true,
  },
  {
    key: "guardian-signature",
    name: "Firma del responsable pendiente",
    description: "Solicita la aceptación necesaria para una menor.",
    category: "documentos",
    ruleKeys: [],
    timingLabel: "Cuando se requiere aceptación externa",
    recipientLabel: "Responsable y alumna",
    planned: true,
  },
  {
    key: "account-created",
    name: "Cuenta creada / bienvenida",
    description: "Confirma el acceso inicial a Studio Flow.",
    category: "cuenta",
    ruleKeys: [],
    timingLabel: "Al crear el acceso",
    recipientLabel: "Alumna",
    planned: true,
  },
  {
    key: "password-reset",
    name: "Restablecimiento de contraseña",
    description: "Entrega el flujo seguro para recuperar el acceso.",
    category: "cuenta",
    ruleKeys: [],
    timingLabel: "Cuando se solicita recuperar acceso",
    recipientLabel: "Usuario",
    essential: true,
    planned: true,
  },
  {
    key: "coach-change",
    name: "Cambio de coach",
    description: "Informa cuando cambia el coach de una sesión reservada.",
    category: "reservas",
    ruleKeys: [],
    timingLabel: "Al cambiar el coach",
    recipientLabel: "Alumnas con reserva",
    planned: true,
  },
  {
    key: "studio-closure",
    name: "Cierre extraordinario / día festivo",
    description: "Informa cambios excepcionales que afectan clases publicadas.",
    category: "reservas",
    ruleKeys: [],
    timingLabel: "Al aplicar el cambio operativo",
    recipientLabel: "Personas afectadas",
    essential: true,
    planned: true,
  },
];

export type MarketingDefinition = {
  key: string;
  name: string;
  description: string;
  category: "recuperacion" | "promociones" | "fidelizacion";
  automationCodes?: readonly string[];
  planned?: boolean;
};

export const MARKETING_COMMUNICATIONS: readonly MarketingDefinition[] = [
  {
    key: "inactive-students",
    name: "Alumnas inactivas",
    description: "Reconecta con alumnas que llevan tiempo sin asistir.",
    category: "recuperacion",
    automationCodes: ["AUT-CAT-14"],
  },
  {
    key: "package-renewal",
    name: "Paquete por renovar",
    description: "Invita a renovar al acercarse el fin del paquete.",
    category: "recuperacion",
    automationCodes: ["AUT-CAT-13", "AUT-CAT-15", "AUT-CAT-16"],
  },
  {
    key: "special-promotions",
    name: "Promociones especiales",
    description: "Comunica promociones activas a segmentos seleccionados.",
    category: "promociones",
    planned: true,
  },
  {
    key: "birthday",
    name: "Cumpleaños",
    description: "Envía un mensaje especial en el cumpleaños de la alumna.",
    category: "fidelizacion",
    planned: true,
  },
  {
    key: "challenges",
    name: "Invitación a retos",
    description: "Invita a participar en retos activos del estudio.",
    category: "fidelizacion",
    planned: true,
  },
  {
    key: "events",
    name: "Eventos y talleres",
    description: "Informa sobre talleres, workshops y clases especiales.",
    category: "promociones",
    planned: true,
  },
  {
    key: "referrals",
    name: "Referidos",
    description: "Activa comunicaciones de recomendación y beneficios.",
    category: "fidelizacion",
    planned: true,
  },
  {
    key: "manual-campaigns",
    name: "Campañas manuales",
    description: "Envía una campaña puntual a un segmento elegido.",
    category: "promociones",
    planned: true,
  },
];

export function getNotificationProcess(key: string) {
  return NOTIFICATION_PROCESSES.find((process) => process.key === key) ?? null;
}
