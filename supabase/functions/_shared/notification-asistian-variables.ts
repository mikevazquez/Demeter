export type NotificationTemplateVariables = Record<string, unknown>;

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dedupeLocationLabel(value: unknown) {
  const raw = safeText(value);
  if (!raw) return null;

  const seen = new Set<string>();
  const parts = raw
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLocaleLowerCase("es-MX");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return parts.join(" · ") || null;
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

function formatDateOnly(value: unknown, timezoneValue: unknown) {
  const raw = safeText(value);
  if (!raw) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
  if (!Number.isFinite(date.getTime())) return raw;
  const timezone = safeText(timezoneValue) ?? "UTC";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  } catch {
    return raw;
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
        ubicacion: dedupeLocationLabel(variables.location),
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
        nombre: safeText(variables.recipient_name) ?? "Alumna",
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
      };
    }

    case "evaluation_reminder":
      return { ...common };

    case "package_activated":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        fecha_inicio: formatDateOnly(variables.starts_on, variables.studio_timezone),
        fecha_vencimiento: formatDateOnly(variables.expires_on, variables.studio_timezone),
      };

    case "package_expired":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        fecha_vencimiento: formatDateOnly(variables.expires_on, variables.studio_timezone),
      };

    case "package_expiring":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        fecha_vencimiento: formatDateOnly(variables.expires_on, variables.studio_timezone),
        dias_restantes: safeNumber(variables.days_before),
      };

    case "coach_roster_reminder":
      return {
        coach: safeText(variables.recipient_name) ?? "Coach",
        clase: safeText(variables.class_name) ?? "Clase",
        fecha: starts.fecha,
        hora: starts.hora,
        total: safeNumber(variables.roster_count) ?? 0,
        alumnas: safeText(variables.roster_names) ?? "Sin alumnas reservadas",
      };

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

    case "class_cancelled_student":
    case "session_cancelled_by_studio":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        clase: safeText(variables.class_name) ?? "Clase",
        fecha: starts.fecha,
        hora: starts.hora,
      };

    case "challenge_invitation":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        reto: safeText(variables.challenge_name) ?? "un nuevo reto",
      };

    case "workshop_event":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        evento: safeText(variables.event_name) ?? "un taller especial",
        fecha: formatDateOnly(variables.event_date, variables.studio_timezone) ?? "próximamente",
      };

    case "referral_invitation":
      return { nombre: safeText(variables.recipient_name) ?? "Alumna" };

    case "package_recovery_1":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        paquete: safeText(variables.previous_package_name) ?? "tus clases",
        fecha_vencimiento:
          formatDateOnly(variables.expires_on, variables.studio_timezone) ?? "la fecha indicada",
      };

    case "package_recovery_2":
      return { nombre: safeText(variables.recipient_name) ?? "Alumna" };

    case "attendance_no_show":
    case "credit_restored":
    case "waitlist_expired":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        clase: safeText(variables.class_name) ?? "Clase",
        fecha: starts.fecha ?? "la fecha indicada",
      };

    case "document_new_version":
    case "guardian_signature_pending":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        documento:
          safeText(variables.document_title) ?? safeText(variables.document_name) ?? "documento",
      };

    case "documents_pending":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        documentos: safeText(variables.pending_documents) ?? "documentos pendientes",
      };

    case "evaluation_completed":
    case "evaluation_invitation":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        disciplina: safeText(variables.discipline_name) ?? "tu disciplina",
      };

    case "evaluation_scheduled":
      return { ...common };

    case "password_reset":
      return { nombre: safeText(variables.recipient_name) ?? "Alumna" };

    case "payment_confirmed":
    case "payment_pending":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        monto:
          safeText(variables.amount_label) ??
          safeNumber(variables.amount_minor)?.toLocaleString("es-MX") ??
          "el monto indicado",
        fecha:
          formatDateOnly(variables.paid_at ?? variables.created_at, variables.studio_timezone) ??
          "hoy",
        fecha_vencimiento:
          formatDateOnly(variables.due_on, variables.studio_timezone) ?? "la fecha indicada",
      };

    case "session_coach_changed":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        clase: safeText(variables.class_name) ?? "Clase",
        coach: safeText(variables.coach_name) ?? safeText(variables.coach) ?? "tu coach",
        fecha: starts.fecha ?? "la fecha indicada",
        hora: starts.hora ?? "la hora indicada",
      };

    case "studio_closure":
      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        estudio: safeText(variables.studio_name) ?? "el estudio",
        fecha:
          formatDateOnly(
            variables.closure_date ?? variables.event_date,
            variables.studio_timezone,
          ) ?? "la fecha indicada",
      };

    case "class_rescheduled": {
      const oldStarts = formatNotificationDateTimeParts(
        variables.old_starts_at,
        variables.studio_timezone,
      );
      const newStarts = formatNotificationDateTimeParts(
        variables.session_starts_at ?? variables.new_starts_at,
        variables.studio_timezone,
      );

      return {
        nombre: safeText(variables.recipient_name) ?? "Alumna",
        clase: safeText(variables.class_name) ?? "Clase",
        fecha_anterior: oldStarts.fecha,
        hora_anterior: oldStarts.hora,
        fecha_nueva: newStarts.fecha,
        hora_nueva: newStarts.hora,
      };
    }

    default:
      return variables;
  }
}
