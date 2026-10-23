import { POLE_LEVEL_LABEL, POLE_LEVEL_RANK, type PoleFigure, type PoleGroupLevel } from "./types";

export type ComboStudent = {
  id: string;
  name: string;
  /** Nivel de catálogo; null si la alumna no tiene evaluación en la disciplina. */
  level: PoleGroupLevel | null;
  achieved: ReadonlySet<string>;
};

export type ComboGroup = {
  level: PoleGroupLevel;
  label: string;
  students: ComboStudent[];
  /** Alumnas sin evaluación que se trataron como principiantes. */
  withoutLevel: ComboStudent[];
};

export type ComboOption = {
  sequence: string[];
  newFigureId: string;
  prerequisiteId: string | null;
  /** Índice 0-based de la opción mostrada y total de opciones posibles. */
  index: number;
  total: number;
  explanation: string;
};

const GROUP_LABEL: Record<PoleGroupLevel, string> = {
  principiante: "Principiantes",
  intermedio: "Intermedias",
  avanzado: "Avanzadas",
};

const PREFERRED_TYPES = new Set(["Giro", "Invertida"]);

/** Agrupa a las alumnas por nivel. Las que no tienen nivel van con principiantes. */
export function groupStudentsByLevel(students: ComboStudent[]): ComboGroup[] {
  const order: PoleGroupLevel[] = ["principiante", "intermedio", "avanzado"];
  return order
    .map((level) => {
      const members = students.filter((student) => (student.level ?? "principiante") === level);
      return {
        level,
        label: GROUP_LABEL[level],
        students: members,
        withoutLevel: members.filter((student) => student.level === null),
      };
    })
    .filter((group) => group.students.length > 0);
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function achievedByAll(group: ComboGroup, figureId: string) {
  return group.students.every((student) => student.achieved.has(figureId));
}

function achievedByNone(group: ComboGroup, figureId: string) {
  return group.students.every((student) => !student.achieved.has(figureId));
}

/** Figuras nuevas posibles para el grupo, en el orden en que se proponen. */
export function comboCandidates(group: ComboGroup, figures: readonly PoleFigure[]): PoleFigure[] {
  return figures
    .filter(
      (figure) =>
        figure.level === group.level &&
        figure.prerequisites.length > 0 &&
        achievedByNone(group, figure.id) &&
        figure.prerequisites.every((id) => achievedByAll(group, id)),
    )
    .sort(
      (a, b) =>
        Number(PREFERRED_TYPES.has(b.type)) - Number(PREFERRED_TYPES.has(a.type)) ||
        a.sort_order - b.sort_order,
    );
}

/**
 * Genera la opción k de combo para un grupo:
 * [1 prerrequisito ya dominado] → [figura nueva] → [hasta 2 figuras dominadas del mismo tipo].
 * Nunca usa figuras Profesional.
 */
export function generateCombo(
  group: ComboGroup,
  allFigures: readonly PoleFigure[],
  k = 0,
): ComboOption | null {
  const figures = allFigures.filter((figure) => figure.level !== "profesional");
  const candidates = comboCandidates(group, figures);
  if (!candidates.length) return null;

  const index = ((k % candidates.length) + candidates.length) % candidates.length;
  const newFigure = candidates[index];
  const groupRank = POLE_LEVEL_RANK[group.level];

  const known = figures
    .filter(
      (figure) => POLE_LEVEL_RANK[figure.level] <= groupRank && achievedByAll(group, figure.id),
    )
    .sort(
      (a, b) =>
        Number(b.level === group.level) - Number(a.level === group.level) ||
        a.sort_order - b.sort_order,
    );
  const knownIds = new Set(known.map((figure) => figure.id));

  const prerequisiteId = newFigure.prerequisites.find((id) => knownIds.has(id)) ?? null;
  const used = new Set<string>([newFigure.id, ...(prerequisiteId ? [prerequisiteId] : [])]);
  const need = prerequisiteId ? 2 : 3;
  const others: string[] = [];

  const sameType = known.filter((figure) => figure.type === newFigure.type && !used.has(figure.id));
  for (let i = 0; i < sameType.length && others.length < need; i += 1) {
    const pick = sameType[(i + index * 2) % sameType.length];
    if (!used.has(pick.id)) {
      others.push(pick.id);
      used.add(pick.id);
    }
  }

  const rest = known.filter((figure) => figure.level === group.level && !used.has(figure.id));
  for (let i = 0; i < rest.length && others.length < need; i += 1) {
    const pick = rest[(i + index) % rest.length];
    if (!used.has(pick.id)) {
      others.push(pick.id);
      used.add(pick.id);
    }
  }

  const byId = new Map(figures.map((figure) => [figure.id, figure]));
  const names = joinNames(group.students.map((student) => student.name));
  const plural = group.students.length > 1;
  const prerequisiteName = prerequisiteId ? byId.get(prerequisiteId)?.name : null;
  const explanation = prerequisiteName
    ? `${names} ${plural ? "ya saben" : "ya sabe"} ${prerequisiteName}, que es el paso previo de ${newFigure.name}, así que hoy ${plural ? "pueden" : "puede"} intentarla.`
    : `${newFigure.name} es la figura nueva de nivel ${POLE_LEVEL_LABEL[group.level]}.`;

  return {
    sequence: [...(prerequisiteId ? [prerequisiteId] : []), newFigure.id, ...others],
    newFigureId: newFigure.id,
    prerequisiteId,
    index,
    total: candidates.length,
    explanation,
  };
}
