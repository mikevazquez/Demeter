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
    key: "reservation-modified",
    name: "Reserva modificada",
    description: "Informa cuando cambia información relevante de una reserva.",
    category: "reservas",
    ruleKeys: ["p0.booking.modified"],
    timingLabel: "Al modificar la reserva · inmediata",
    recipientLabel: "Alumna de la reserva",
  },
  {
    key: "reservation-cancelled",
    name: "Reserva cancelada por alumna",
    description: "Confirma una cancelación realizada por la alumna.",
    category: "reservas",
    ruleKeys: ["p0.booking.cancelled_by_student"],
    timingLabel: "Al cancelar la reserva · inmediata",
    recipientLabel: "Alumna de la reserva",
  },
  {
    key: "class-reminder",
    name: "Recordatorio de clase",
    description: "Ayuda a reducir inasistencias antes de la clase.",
    category: "reservas",
    ruleKeys: ["p0.booking.class_reminder_5h", "p0.session.rescheduled_reminder_5h"],
    timingLabel: "5 h antes de la clase · configurable",
    recipientLabel: "Alumna con reserva confirmada",
  },
  {
    key: "late-cancellation",
    name: "Cancelación tardía",
    description: "Explica la pérdida de crédito o penalización aplicada.",
    category: "reservas",
    ruleKeys: ["p0.booking.cancelled_late"],
    timingLabel: "Al cancelar dentro de la ventana tardía · inmediata",
    recipientLabel: "Alumna de la reserva",
  },
  {
    key: "no-show",
    name: "No show",
    description: "Informa el cierre de una reserva sin asistencia.",
    category: "reservas",
    ruleKeys: ["p0.attendance.no_show"],
    timingLabel: "Al finalizar la sesión · inmediata",
    recipientLabel: "Alumna ausente",
  },
  {
    key: "class-cancelled-by-studio",
    name: "Clase cancelada por el estudio",
    description: "Avisa cuando el estudio cancela una clase por una razón operativa.",
    category: "reservas",
    ruleKeys: ["p0.session.cancelled_by_studio"],
    timingLabel: "Al cancelar la clase · inmediata",
    recipientLabel: "Alumna afectada",
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
    key: "session-change",
    name: "Cambio de horario / sesión",
    description: "Informa cuando cambia el horario de una sesión con reservas.",
    category: "reservas",
    ruleKeys: ["p0.session.rescheduled_notice"],
    timingLabel: "Al cambiar el horario · inmediata",
    recipientLabel: "Alumnas con reserva confirmada",
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
    key: "waitlist-expired",
    name: "Lugar de lista de espera vencido",
    description: "Informa cuando una oportunidad de reserva deja de estar disponible.",
    category: "reservas",
    ruleKeys: ["p0.waitlist.expired"],
    timingLabel: "Al vencer la oportunidad · inmediata",
    recipientLabel: "Alumna en lista de espera",
  },
  {
    key: "package-activated",
    name: "Paquete comprado o activado",
    description: "Confirma la activación de un paquete.",
    category: "paquetes",
    ruleKeys: ["p0.package.activated"],
    timingLabel: "Al activar un paquete · inmediata",
    recipientLabel: "Alumna",
  },
  {
    key: "package-expiring",
    name: "Paquete próximo a vencer",
    description: "Avisa antes del vencimiento para aprovechar créditos.",
    category: "paquetes",
    ruleKeys: ["p0.package.expiring"],
    timingLabel: "3 días antes del vencimiento",
    recipientLabel: "Alumna con paquete activo",
  },
  {
    key: "package-expired",
    name: "Paquete vencido",
    description: "Informa el fin de vigencia del paquete.",
    category: "paquetes",
    ruleKeys: ["p0.package.expired"],
    timingLabel: "Al vencer el paquete",
    recipientLabel: "Alumna",
  },
  {
    key: "credit-restored",
    name: "Crédito restaurado",
    description: "Confirma cuando Demeter devuelve un crédito.",
    category: "paquetes",
    ruleKeys: ["p0.credit.restored"],
    timingLabel: "Al restaurar el crédito · inmediata",
    recipientLabel: "Alumna",
  },
  {
    key: "payment-pending",
    name: "Pago pendiente",
    description: "Solicita completar una operación pendiente.",
    category: "paquetes",
    ruleKeys: ["p0.payment.pending"],
    timingLabel: "Cuando queda un pago pendiente · inmediata",
    recipientLabel: "Alumna",
  },
  {
    key: "payment-confirmed",
    name: "Pago confirmado",
    description: "Confirma que un pago quedó acreditado.",
    category: "paquetes",
    ruleKeys: ["p0.payment.confirmed"],
    timingLabel: "Al confirmar el pago · inmediata",
    recipientLabel: "Alumna",
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
    key: "evaluation-reminder",
    name: "Recordatorio de evaluación",
    description: "Recuerda una evaluación próxima.",
    category: "evaluaciones",
    ruleKeys: ["p0.evaluation.reminder"],
    timingLabel: "24 h antes de la evaluación",
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
    key: "documents-pending",
    name: "Documentos pendientes",
    description: "Avisa cuando faltan documentos obligatorios por aceptar.",
    category: "documentos",
    ruleKeys: ["p0.documents.pending"],
    timingLabel: "Al mantener documentos pendientes",
    recipientLabel: "Alumna",
  },
  {
    key: "document-new-version",
    name: "Nueva versión de documento",
    description: "Avisa cuando un documento obligatorio requiere nueva revisión.",
    category: "documentos",
    ruleKeys: ["p0.document.new_version"],
    timingLabel: "Al activar una nueva versión · inmediata",
    recipientLabel: "Personas afectadas",
  },
  {
    key: "guardian-signature",
    name: "Firma del responsable pendiente",
    description: "Solicita completar la aceptación necesaria para una menor.",
    category: "documentos",
    ruleKeys: ["p0.guardian.signature_pending"],
    timingLabel: "Al generar la solicitud al responsable · inmediata",
    recipientLabel: "Alumna; responsable por canal externo cuando esté disponible",
  },
  {
    key: "account-created",
    name: "Cuenta creada / bienvenida",
    description: "Confirma el acceso inicial a Demeter.",
    category: "cuenta",
    ruleKeys: ["p0.account.created"],
    timingLabel: "Al crear el acceso · inmediata",
    recipientLabel: "Alumna",
  },
  {
    key: "password-reset",
    name: "Restablecimiento de contraseña",
    description: "Entrega el flujo seguro para recuperar el acceso.",
    category: "cuenta",
    ruleKeys: ["p0.password.reset"],
    timingLabel: "Cuando se restablece el acceso · inmediata",
    recipientLabel: "Usuario",
    essential: true,
  },
  {
    key: "coach-change",
    name: "Cambio de coach",
    description: "Informa cuando cambia el coach de una sesión reservada.",
    category: "reservas",
    ruleKeys: ["p0.session.coach_changed"],
    timingLabel: "Al cambiar el coach · inmediata",
    recipientLabel: "Alumnas con reserva",
  },
  {
    key: "studio-closure",
    name: "Cierre extraordinario / día festivo",
    description: "Informa cambios excepcionales que afectan clases publicadas.",
    category: "reservas",
    ruleKeys: ["p0.studio.closure"],
    timingLabel: "Al aplicar el cambio operativo · inmediata",
    recipientLabel: "Alumnas afectadas",
    essential: true,
  },
];

export type MarketingDefinition = {
  key: string;
  name: string;
  description: string;
  category: "recuperacion" | "promociones" | "fidelizacion";
  automationCodes?: readonly string[];
  planned?: boolean;
  defaultAudience:
    | "all_eligible"
    | "active_students"
    | "inactive_students"
    | "package_expiring"
    | "package_expired"
    | "trial_no_purchase";
  defaultTitle: string;
  defaultBody: string;
};

export const MARKETING_COMMUNICATIONS: readonly MarketingDefinition[] = [
  {
    key: "inactive-students",
    name: "Alumnas inactivas",
    description: "Reconecta con alumnas que llevan tiempo sin asistir.",
    category: "recuperacion",
    automationCodes: ["AUT-CAT-14"],
    defaultAudience: "inactive_students",
    defaultTitle: "Te extrañamos",
    defaultBody: "Hace tiempo que no vienes. Revisa tus próximas opciones en Studio Flow.",
  },
  {
    key: "package-renewal",
    name: "Paquete por renovar",
    description: "Invita a renovar al acercarse el fin del paquete.",
    category: "recuperacion",
    automationCodes: ["AUT-CAT-13", "AUT-CAT-15", "AUT-CAT-16"],
    defaultAudience: "package_expiring",
    defaultTitle: "Tu paquete está por vencer",
    defaultBody: "Aprovecha tus créditos antes de que termine la vigencia.",
  },
  {
    key: "special-promotions",
    name: "Promociones especiales",
    description: "Comunica promociones activas a segmentos seleccionados.",
    category: "promociones",
    planned: true,
    defaultAudience: "all_eligible",
    defaultTitle: "Tenemos algo especial para ti",
    defaultBody: "Consulta esta promoción disponible en Studio Flow.",
  },
  {
    key: "birthday",
    name: "Cumpleaños",
    description: "Envía un mensaje especial en el cumpleaños de la alumna.",
    category: "fidelizacion",
    planned: true,
    defaultAudience: "all_eligible",
    defaultTitle: "¡Feliz cumpleaños!",
    defaultBody: "Hoy celebramos contigo. Tenemos un mensaje especial para ti en Studio Flow.",
  },
  {
    key: "challenges",
    name: "Invitación a retos",
    description: "Invita a participar en retos activos del estudio.",
    category: "fidelizacion",
    planned: true,
    defaultAudience: "active_students",
    defaultTitle: "Nuevo reto disponible",
    defaultBody: "Ya puedes participar en el nuevo reto de Studio Flow.",
  },
  {
    key: "events",
    name: "Eventos y talleres",
    description: "Informa sobre talleres, workshops y clases especiales.",
    category: "promociones",
    planned: true,
    defaultAudience: "all_eligible",
    defaultTitle: "Nuevo evento en el estudio",
    defaultBody: "Conoce los detalles y reserva tu lugar en Studio Flow.",
  },
  {
    key: "referrals",
    name: "Referidos",
    description: "Activa comunicaciones de recomendación y beneficios.",
    category: "fidelizacion",
    planned: true,
    defaultAudience: "active_students",
    defaultTitle: "Invita a alguien a entrenar contigo",
    defaultBody: "Comparte Studio Flow y consulta los beneficios disponibles para referidos.",
  },
  {
    key: "manual-campaigns",
    name: "Campañas manuales",
    description: "Envía una campaña puntual a un segmento elegido.",
    category: "promociones",
    planned: true,
    defaultAudience: "all_eligible",
    defaultTitle: "Mensaje de Demeter Fitness",
    defaultBody: "Tenemos una novedad para ti. Consulta los detalles en Studio Flow.",
  },
];

export function getNotificationProcess(key: string) {
  return NOTIFICATION_PROCESSES.find((process) => process.key === key) ?? null;
}

export function getMarketingCommunication(key: string) {
  return MARKETING_COMMUNICATIONS.find((item) => item.key === key) ?? null;
}
