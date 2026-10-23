/** P360-V2 · Formatos y textos compartidos por las pestañas del Perfil 360. */
export const structuralFieldKeys = new Set(["first_name", "last_name", "phone", "email"]);

export const lifecycleCopy: Record<string, string> = {
  active: "Activa",
  inactive: "Inactiva",
};

export const acquisitionStatusCopy: Record<string, string> = {
  active: "Activa",
  expired: "Vencida",
  cancelled: "Cancelada",
};

export const communicationOriginCopy: Record<string, string> = {
  admin: "Administración",
  student: "Alumna",
  system: "Sistema",
  integration: "Integración",
};

export const communicationFieldCopy: Record<string, string> = {
  operational: "Operativas",
  reminders: "Recordatorios",
  retention: "Retención / seguimiento",
  promotions: "Promociones",
  whatsapp_blocked: "Bloqueo total de WhatsApp",
};

export function optionValues(options: unknown): string[] {
  if (Array.isArray(options))
    return options.filter((value): value is string => typeof value === "string");

  if (options && typeof options === "object" && "choices" in options) {
    const choices = (options as { choices?: unknown }).choices;
    if (Array.isArray(choices)) {
      return choices.filter((value): value is string => typeof value === "string");
    }
  }

  return [];
}

export function scalarValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

export function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatDateTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function rewardStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked: "Bloqueada",
    available: "Disponible",
    reserved: "Reservada",
    redeemed: "Usada",
    expired: "Vencida",
    revoked: "Revocada",
  };
  return labels[status] ?? status;
}

export function rewardBenefitLabel(
  kind: string,
  benefit: unknown,
  locale: string,
  currency: string,
) {
  const data = benefit && typeof benefit === "object" ? (benefit as Record<string, unknown>) : {};
  if (kind === "credits" && typeof data.credits === "number") {
    return String(data.credits) + (data.credits === 1 ? " crédito" : " créditos");
  }
  if (kind === "percentage_discount" && typeof data.percentage === "number") {
    return String(data.percentage) + "% de descuento";
  }
  if (kind === "fixed_discount" && typeof data.amount_minor === "number") {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(data.amount_minor / 100) + " de descuento"
    );
  }
  if (kind === "validity_extension" && typeof data.days === "number") {
    return String(data.days) + (data.days === 1 ? " día extra" : " días extra");
  }
  const labels: Record<string, string> = {
    surcharge_waiver: "Recargo bonificado",
    special_benefit: "Beneficio especial",
    badge: "Insignia",
    custom_manual: "Beneficio manual",
  };
  return labels[kind] ?? "Recompensa";
}

export function localDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return year + "-" + month + "-" + day;
}

export function formatMoney(minor: number, locale: string, currency: string, digits = 0) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
  }).format(minor / 100);
}

export const profileErrorCopy: Record<string, string> = {
  phone_exists: "Ese teléfono ya pertenece a otra alumna.",
  profile_fields: "No se pudieron guardar los campos adicionales. Revisa sus valores.",
  acquisition_forbidden: "Tu rol no puede modificar adquisiciones.",
  acquisition_not_found: "La adquisición ya no está disponible.",
  acquisition_date_invalid: "Selecciona una fecha de inicio válida.",
  credits_invalid: "Indica créditos disponibles válidos y un motivo obligatorio.",
  adjustment_reason_required: "El motivo del ajuste de créditos es obligatorio.",
  unlimited_acquisition: "Una adquisición ilimitada no admite ajuste manual de créditos.",
  acquisition_not_editable: "Esta adquisición ya no puede modificarse.",
  communication_preferences:
    "No se pudieron guardar las preferencias de comunicación. Inténtalo de nuevo.",
  transfer_review: "No se pudo actualizar la validación de la transferencia.",
};
