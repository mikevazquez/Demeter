import type { ReactNode } from "react";

export type JsonObject = Record<string, unknown>;

export const familyLabels: Record<string, string> = {
  loyalty: "Fidelidad",
  attendance: "Asistencia / racha",
  challenge: "Reto",
  achievement: "Logro",
};

export const ruleStatusLabels: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  active: "Activa",
  paused: "Pausada",
  finished: "Finalizada",
  cancelled: "Cancelada",
};

export const rewardStatusLabels: Record<string, string> = {
  blocked: "Bloqueada",
  available: "Disponible",
  reserved: "En uso",
  redeemed: "Utilizada",
  expired: "Vencida",
  revoked: "Ajustada",
};

export const incidentStatusLabels: Record<string, string> = {
  detected: "Detectada",
  in_review: "En revisión",
  resolved_automatic: "Resuelta automáticamente",
  resolved_manual: "Resuelta manualmente",
  no_action_required: "Sin acción requerida",
  closed: "Cerrada",
};

export const incidentPriorityLabels: Record<string, string> = {
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

export const rewardKindLabels: Record<string, string> = {
  percentage_discount: "% de descuento",
  fixed_discount: "Descuento fijo",
  credits: "Créditos",
  validity_extension: "Extensión de vigencia",
  surcharge_waiver: "Eliminar recargo",
  special_benefit: "Beneficio especial",
  badge: "Insignia",
  custom_manual: "Recompensa personalizada",
};

export function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function statusTone(status: string) {
  if (
    ["active", "available", "fulfilled", "resolved_automatic", "resolved_manual"].includes(status)
  ) {
    return "bg-emerald-500/15 text-emerald-300";
  }
  if (["paused", "reserved", "scheduled", "in_review"].includes(status)) {
    return "bg-amber-500/15 text-amber-300";
  }
  if (["cancelled", "revoked", "critical"].includes(status)) {
    return "bg-rose-500/15 text-rose-300";
  }
  if (["finished", "redeemed", "expired", "closed"].includes(status)) {
    return "bg-zinc-500/15 text-zinc-300";
  }
  return "bg-fuchsia-500/15 text-fuchsia-300";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}
    >
      {label ??
        ruleStatusLabels[status] ??
        rewardStatusLabels[status] ??
        incidentStatusLabels[status] ??
        status}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {detail ? <div className="mt-1 text-xs text-zinc-500">{detail}</div> : null}
    </article>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/15 p-7 text-center">
      <strong className="text-sm text-white">{title}</strong>
      {children ? <div className="mt-2 text-sm leading-6 text-zinc-500">{children}</div> : null}
    </div>
  );
}

export function rewardBenefitLabel(kind: string, value: unknown) {
  const definition = asObject(value);

  if (kind === "percentage_discount") {
    return `${Number(definition.percent ?? 0)}% de descuento`;
  }
  if (kind === "fixed_discount") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(Number(definition.amount_minor ?? 0) / 100);
  }
  if (kind === "credits") {
    const credits = Number(definition.credits ?? 0);
    return `${credits} crédito${credits === 1 ? "" : "s"}`;
  }
  if (kind === "validity_extension") {
    const days = Number(definition.days ?? 0);
    return `${days} día${days === 1 ? "" : "s"} de vigencia`;
  }
  if (kind === "surcharge_waiver") {
    return String(definition.label ?? definition.waiver ?? "Sin recargo");
  }
  if (kind === "badge") {
    return String(definition.title ?? definition.label ?? "Insignia");
  }
  return String(
    definition.label ?? definition.description ?? rewardKindLabels[kind] ?? "Beneficio",
  );
}

export function primaryConditionSummary(value: unknown) {
  const definition = asObject(value);
  const conditions = Array.isArray(definition.conditions) ? definition.conditions : [];
  if (!conditions.length) return "Sin condición configurada";
  const first = asObject(conditions[0]);
  const comparatorCopy: Record<string, string> = {
    gte: "≥",
    gt: ">",
    eq: "=",
    lte: "≤",
    lt: "<",
    neq: "≠",
  };
  return `${String(first.metric ?? "métrica")} ${comparatorCopy[String(first.comparator ?? "gte")] ?? String(first.comparator ?? "")} ${String(first.target ?? "—")}`;
}

export function progressSummary(value: unknown) {
  const progress = asObject(value);
  const entries = Object.entries(progress)
    .filter(([, current]) => typeof current === "number" || typeof current === "boolean")
    .slice(0, 3);

  if (!entries.length) return "Sin progreso cuantificable todavía.";

  return entries
    .map(([key, current]) => `${key.replaceAll("_", " ")}: ${String(current)}`)
    .join(" · ");
}

export function rewardDefinitionLabel(value: unknown) {
  const definition = asObject(value);
  const rewards = Array.isArray(definition.rewards) ? definition.rewards : null;
  const first = rewards?.length ? asObject(rewards[0]) : definition;
  const kind = String(first.kind ?? "custom_manual");
  return rewardBenefitLabel(kind, first);
}
