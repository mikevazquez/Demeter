import {
  POLE_LEVEL_RANK,
  type PoleFigure,
  type PoleGroupLevel,
  type StudentPoleFigure,
} from "./types";

/**
 * Estado de una figura para una alumna. Refleja exactamente la regla que valida el
 * servidor en private.pole_mark_block_reason (la UI sólo la muestra).
 */
export const POLE_FIGURE_STATES = [
  "lograda",
  "disponible",
  "bloqueada",
  "siguiente_nivel",
  "requiere_autorizacion",
  "autorizada",
] as const;
export type PoleFigureState = (typeof POLE_FIGURE_STATES)[number];

export type PoleFigureStatus = {
  state: PoleFigureState;
  /** Prerrequisitos que faltan (sólo en "bloqueada"). */
  missing: string[];
  /** En "disponible": "siguiente" si tiene prerrequisitos (ya cumplidos), "libre" si no tiene. */
  availability?: "siguiente" | "libre";
};

export type PoleStateContext = {
  achieved: ReadonlySet<string>;
  authorized: ReadonlySet<string>;
  /** Nivel de catálogo de la alumna. Sin evaluación se trata como principiante. */
  studentLevel: PoleGroupLevel;
};

export function figureStatus(
  figure: Pick<PoleFigure, "id" | "level" | "prerequisites">,
  context: PoleStateContext,
): PoleFigureStatus {
  if (context.achieved.has(figure.id)) return { state: "lograda", missing: [] };

  if (figure.level === "profesional") {
    return {
      state: context.authorized.has(figure.id) ? "autorizada" : "requiere_autorizacion",
      missing: [],
    };
  }

  if (POLE_LEVEL_RANK[figure.level] > POLE_LEVEL_RANK[context.studentLevel]) {
    return { state: "siguiente_nivel", missing: [] };
  }

  const missing = figure.prerequisites.filter((id) => !context.achieved.has(id));
  if (missing.length) return { state: "bloqueada", missing };

  return {
    state: "disponible",
    missing: [],
    availability: figure.prerequisites.length ? "siguiente" : "libre",
  };
}

export function canMark(status: PoleFigureStatus) {
  return status.state === "disponible" || status.state === "autorizada";
}

export function buildStateContext(
  figures: StudentPoleFigure[],
  studentLevel: PoleGroupLevel | null | undefined,
): PoleStateContext {
  return {
    achieved: new Set(figures.filter((figure) => figure.achievement).map((figure) => figure.id)),
    authorized: new Set(figures.filter((figure) => figure.authorized).map((figure) => figure.id)),
    studentLevel: studentLevel ?? "principiante",
  };
}

/**
 * Todos los ancestros (prerrequisitos directos e indirectos) en orden topológico:
 * desde la figura de inicio hasta el prerrequisito más cercano. No incluye la figura.
 */
export function ancestorsOf(figureId: string, byId: ReadonlyMap<string, PoleFigure>): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (seen.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) visit(prerequisite);
    visiting.delete(id);
    seen.add(id);
    if (id !== figureId) ordered.push(id);
  }

  visit(figureId);
  return ordered;
}

/** Figuras que piden directamente a esta como prerrequisito. */
export function childrenOf(figureId: string, figures: readonly PoleFigure[]): PoleFigure[] {
  return figures.filter((figure) => figure.prerequisites.includes(figureId));
}

export type StudentPoleSummary = {
  done: number;
  total: number;
  /** Figuras del programa base del nivel de la alumna. */
  levelFigures: StudentPoleFigure[];
  achieved: StudentPoleFigure[];
  next: StudentPoleFigure[];
  free: StudentPoleFigure[];
  blocked: { figure: StudentPoleFigure; missing: string[] }[];
  pro: {
    authorized: StudentPoleFigure[];
    achieved: StudentPoleFigure[];
    locked: StudentPoleFigure[];
  };
};

/**
 * Resumen para el portal. El contador "X de Y" sólo cuenta el programa base del nivel
 * de la alumna; las figuras Profesional tienen su propio conteo.
 */
export function summarizeForStudent(
  figures: StudentPoleFigure[],
  context: PoleStateContext,
): StudentPoleSummary {
  const levelFigures = figures
    .filter((figure) => figure.core && figure.level === context.studentLevel)
    .sort((a, b) => a.sort_order - b.sort_order);

  const achieved: StudentPoleFigure[] = [];
  const next: StudentPoleFigure[] = [];
  const free: StudentPoleFigure[] = [];
  const blocked: { figure: StudentPoleFigure; missing: string[] }[] = [];

  for (const figure of levelFigures) {
    const status = figureStatus(figure, context);
    if (status.state === "lograda") achieved.push(figure);
    else if (status.state === "bloqueada") blocked.push({ figure, missing: status.missing });
    else if (status.state === "disponible") {
      (status.availability === "siguiente" ? next : free).push(figure);
    }
  }

  const proFigures = figures.filter((figure) => figure.level === "profesional");

  return {
    done: achieved.length,
    total: levelFigures.length,
    levelFigures,
    achieved,
    next,
    free,
    blocked,
    pro: {
      authorized: proFigures.filter(
        (figure) => context.authorized.has(figure.id) && !context.achieved.has(figure.id),
      ),
      achieved: proFigures.filter((figure) => context.achieved.has(figure.id)),
      locked: proFigures.filter(
        (figure) => !context.authorized.has(figure.id) && !context.achieved.has(figure.id),
      ),
    },
  };
}

/** Agrupa figuras por familia, de la familia más grande a la más chica. */
export function groupByFamily<T extends Pick<PoleFigure, "family">>(figures: T[]) {
  const groups = new Map<string, T[]>();
  for (const figure of figures) {
    const list = groups.get(figure.family) ?? [];
    list.push(figure);
    groups.set(figure.family, list);
  }
  return [...groups.entries()]
    .map(([family, items]) => ({ family, items }))
    .sort((a, b) => b.items.length - a.items.length || a.family.localeCompare(b.family, "es"));
}
