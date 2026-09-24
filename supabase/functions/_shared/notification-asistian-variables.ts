export type NotificationTemplateVariables = Record<string, unknown>;

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeAsistianPhone(value: unknown) {
  const raw = safeText(value);
  if (!raw) return null;
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;

  const digits = raw.replace(/\D/g, "");
  if (/^[1-9][0-9]{9}$/.test(digits)) return `+52${digits}`;
  if (/^52[1-9][0-9]{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export function formatNotificationDateTimeParts(value: unknown, timezoneValue: unknown) {
  const raw = safeText(value);
  if (!raw) return { fecha: null, hora: null, label: null };

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    return { fecha: null, hora: null, label: raw };
  }

  const timezone = safeText(timezoneValue) ?? "UTC";

  try {
    const fecha = new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);

    const hora = new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);

    const label = new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    })
      .format(date)
      .replace(/\.$/, "");

    return { fecha, hora, label };
  } catch {
    return { fecha: null, hora: null, label: date.toISOString() };
  }
}

export function buildAsistianVariables(
  providerTemplateKey: string,
  variables: NotificationTemplateVariables,
): NotificationTemplateVariables {
  const starts = formatNotificationDateTimeParts(
    variables.session_starts_at,
    variables.studio_timezone,
  );

  const common = {
    nombre: safeText(variables.recipient_name) ?? "Alumna",
    disciplina: safeText(variables.discipline_name) ?? safeText(variables.class_name) ?? "Clase",
    fecha: starts.fecha,
    hora: starts.hora,
  };

  switch (providerTemplateKey) {
    case "reservation_confirmed":
    case "waitlist_promoted":
    case "class_reminder":
      return {
        ...common,
        coach: safeText(variables.coach),
        ubicacion: safeText(variables.location),
        creditos_restantes: safeNumber(variables.credits_remaining),
      };

    case "reservation_cancelled": {
      const status = safeText(variables.to_status);
      const tipo =
        status === "cancelled_on_time"
          ? "A tiempo"
          : status === "cancelled_late"
            ? "Tardía"
            : status === "cancelled_by_studio"
              ? "Por el estudio"
              : "Cancelada";

      return {
        clase: safeText(variables.class_name) ?? "Clase",
        fecha: starts.fecha,
        hora: starts.hora,
        tipo_cancelacion: tipo,
        credito_recuperado:
          status === "cancelled_late"
            ? false
            : status === "cancelled_on_time" || status === "cancelled_by_studio"
              ? true
              : null,
        creditos_restantes: safeNumber(variables.credits_remaining),
      };
    }

    case "class_cancelled_coach":
      return {
        coach: safeText(variables.recipient_name) ?? "Coach",
        clase: safeText(variables.class_name) ?? "Clase",
        fecha: starts.fecha,
        hora: starts.hora,
        minimo_reservas: safeNumber(variables.minimum_required),
        reservas_al_revisar: safeNumber(variables.reservations_at_review),
        mensaje: "La clase fue cancelada. No necesitas asistir.",
      };

    default:
      return variables;
  }
}
