import type { ReactNode } from "react";

export type JsonObject = Record<string, unknown>;

export const programStatusLabels: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  paused: "Pausado",
  archived: "Archivado",
};

export const ruleStatusLabels: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  active: "Activo",
  paused: "Pausado",
  finished: "Finalizado",
  cancelled: "Cancelado",
};

export const rewardStatusLabels: Record<string, string> = {
  blocked: "Bloqueada",
  available: "Disponible",
  reserved: "En uso",
  redeemed: "Utilizada",
  expired: "Vencida",
  revoked: "Ajustada",
};

export const metricLabels: Record<string, string> = {
  "attendance.count": "Clases asistidas",
  "attendance.raw_count": "Asistencias registradas",
  "attendance.distinct_days": "Días distintos con asistencia",
  "attendance.distinct_weeks": "Semanas distintas con asistencia",
  "attendance.distinct_months": "Meses distintos con asistencia",
  "attendance.distinct_disciplines": "Disciplinas distintas",
  "attendance.no_show_count": "No shows",
  "attendance.cancellation_count": "Cancelaciones",
  "attendance.streak.days.current": "Racha actual de días",
  "attendance.streak.days.best": "Mejor racha de días",
  "attendance.streak.weeks.current": "Racha actual de semanas",
  "attendance.streak.weeks.best": "Mejor racha de semanas",
  "attendance.streak.months.current": "Racha actual de meses",
  "attendance.streak.months.best": "Mejor racha de meses",
  "loyalty.current_consecutive_periods": "Periodos consecutivos actuales",
  "loyalty.total_paid_periods": "Periodos pagados acumulados",
  "loyalty.best_consecutive_periods": "Mejor racha de periodos",
  "loyalty.effective_days_since_coverage": "Días sin cobertura",
};

export function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function formatDateTime(
  value: string | null | undefined,
  locale: string,
  timeZone: string,
) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export function formatDate(
  value: string | null | undefined,
  locale: string,
  timeZone: string,
) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone,
  }).format(date);
}

export function statusTone(status: string) {
  if (["active", "available", "fulfilled", "completed"].includes(status)) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (["paused", "reserved", "scheduled", "in_progress"].includes(status)) {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (["cancelled", "revoked"].includes(status)) {
    return "border-rose-500/20 bg-rose-500/10 text-rose-300";
  }
  return "border-white/10 bg-white/[0.04] text-zinc-300";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}
    >
      {label ??
        programStatusLabels[status] ??
        ruleStatusLabels[status] ??
        rewardStatusLabels[status] ??
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
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">{label}</p>
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

export function SectionCard({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function rewardBenefitLabel(
  kind: string,
  value: unknown,
  locale: string,
  currency: string,
) {
  const definition = asObject(value);
  if (kind === "percentage_discount") {
    return `${Number(definition.percent ?? 0)}% de descuento`;
  }
  if (kind === "fixed_discount") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
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
  if (kind === "badge") {
    return String(definition.title ?? "Logro");
  }
  return "Beneficio";
}

export function rewardItems(value: unknown) {
  const definition = asObject(value);
  const rewards = asArray(definition.rewards).map(asObject);
  if (rewards.length) return rewards;
  if (definition.kind || definition.delivery) return [definition];
  return [];
}

export function rewardDefinitionLabel(value: unknown, locale: string, currency: string) {
  const items = rewardItems(value);
  const benefit = items.find((item) => String(item.kind ?? "") !== "badge");
  const badge = items.find((item) => String(item.kind ?? "") === "badge");
  if (benefit) return rewardBenefitLabel(String(benefit.kind ?? ""), benefit, locale, currency);
  if (badge) return rewardBenefitLabel("badge", badge, locale, currency);
  return "Sin recompensa económica";
}

export function conditionRows(value: unknown) {
  const definition = asObject(value);
  return asArray(definition.conditions).map(asObject);
}

export function conditionsLabel(value: unknown) {
  const rows = conditionRows(value);
  if (!rows.length) return "Sin condición configurada";
  return rows
    .map((row) => {
      const metric = String(row.metric ?? "");
      const comparator = String(row.comparator ?? "gte");
      const target = String(row.target ?? "—");
      const sign: Record<string, string> = {
        gte: "≥",
        gt: ">",
        eq: "=",
        lte: "≤",
        lt: "<",
        neq: "≠",
      };
      return `${metricLabels[metric] ?? metric} ${sign[comparator] ?? comparator} ${target}`;
    })
    .join(" · ");
}

export function metricValue(progress: unknown, metric: string) {
  const object = asObject(progress);
  const raw = object[metric];
  return typeof raw === "number" ? raw : typeof raw === "boolean" ? Number(raw) : 0;
}
