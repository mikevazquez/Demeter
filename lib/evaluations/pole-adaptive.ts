/**
 * Evaluación adaptativa de Pole: reglas que muestra la pantalla de evaluación en vivo.
 * La parte personalizada la genera el servidor (private.evaluation_pole_generate_personal_items);
 * aquí sólo se interpreta para la instructora.
 */

export const PERSONAL_REASONS = ["pending_previous", "self_marked", "next_level"] as const;
export type PersonalReason = (typeof PERSONAL_REASONS)[number];

export const RESULT_STATUSES = ["meets", "does_not_meet", "not_evaluated"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Días en los que una validación en clase cuenta como reciente. */
export const RECENT_CLASS_DAYS = 14;

export type PoleAchievementSnapshot = {
  source: "student" | "instructor";
  achievedAt: string;
  validatedAt: string | null;
};

export type BaseItemHint =
  | { kind: "recent_class"; date: string; suggestedAttempts: 1 }
  | { kind: "self_marked"; date: string }
  | { kind: "achieved"; date: string }
  | { kind: "missing" };

export type PersonalItem = {
  id: string;
  elementId: string;
  name: string;
  figureType: string;
  reason: PersonalReason;
  resultStatus: ResultStatus;
  attemptCount: number;
  notes: string;
  /** Sólo en next_level: nombres de los pasos previos. */
  prerequisites: string[];
  /** Si ya la tiene marcada (por ejemplo, la volvió a marcar después de no cumplirla). */
  achievement: PoleAchievementSnapshot | null;
};

export type PoleFigureRef = { elementId: string; name: string };

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string) {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

/** Qué sabe StudioFlow de una figura de la plantilla para esta alumna. */
export function baseItemHint(
  achievement: PoleAchievementSnapshot | null | undefined,
  todayIso: string,
): BaseItemHint {
  if (!achievement) return { kind: "missing" };
  if (achievement.validatedAt) {
    const elapsedDays = daysBetween(achievement.validatedAt, todayIso);
    if (elapsedDays >= 0 && elapsedDays <= RECENT_CLASS_DAYS) {
      return { kind: "recent_class", date: achievement.validatedAt, suggestedAttempts: 1 };
    }
    return { kind: "achieved", date: achievement.validatedAt };
  }
  if (achievement.source === "student")
    return { kind: "self_marked", date: achievement.achievedAt };
  return { kind: "achieved", date: achievement.achievedAt };
}

export function groupPersonalItems<T extends Pick<PersonalItem, "reason">>(items: readonly T[]) {
  const groups: Record<PersonalReason, T[]> = {
    pending_previous: [],
    self_marked: [],
    next_level: [],
  };
  for (const item of items) groups[item.reason].push(item);
  return groups;
}

export type PortalChanges = {
  /** Las tenía marcadas ella sin validar y ahora quedan validadas. */
  confirmed: PoleFigureRef[];
  /** No las tenía y entran a su progreso validadas. */
  added: PoleFigureRef[];
  /** No cumplió: vuelven a su próxima evaluación. */
  practice: PoleFigureRef[];
};

export type ScoredFigure = PoleFigureRef & {
  status: ResultStatus;
  achievement: PoleAchievementSnapshot | null;
};

/** Qué cambia en el portal de la alumna al publicar (refleja el trigger de publicación). */
export function portalChanges(figures: readonly ScoredFigure[]): PortalChanges {
  const seen = new Set<string>();
  const changes: PortalChanges = { confirmed: [], added: [], practice: [] };
  for (const figure of figures) {
    if (seen.has(figure.elementId)) continue;
    seen.add(figure.elementId);
    const ref = { elementId: figure.elementId, name: figure.name };
    if (figure.status === "meets") {
      if (!figure.achievement) changes.added.push(ref);
      else if (!figure.achievement.validatedAt) changes.confirmed.push(ref);
    } else if (figure.status === "does_not_meet") {
      changes.practice.push(ref);
    }
  }
  return changes;
}

export type Readiness = {
  baseAchieved: number;
  baseTotal: number;
  percent: number;
  verdict: "ready" | "almost" | "not_yet";
};

/** Preparación: cuántas figuras de la plantilla ya tiene logradas. */
export function readiness(baseAchieved: number, baseTotal: number): Readiness {
  const percent = baseTotal ? Math.round((baseAchieved / baseTotal) * 100) : 0;
  const missing = baseTotal - baseAchieved;
  return {
    baseAchieved,
    baseTotal,
    percent,
    verdict: baseTotal > 0 && missing <= 0 ? "ready" : missing === 1 ? "almost" : "not_yet",
  };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "15 oct" en la zona del estudio. */
export function shortDate(iso: string, timeZone = "America/Mexico_City") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  return `${day} ${MONTHS.at(month - 1)}`;
}

export function joinFigureNames(refs: readonly PoleFigureRef[]) {
  const names = refs.map((ref) => ref.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}
