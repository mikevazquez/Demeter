// POLE-01-08/09 · Student level ↔ catalog level vocabulary shared by catalog and evaluations.

export const POLE_STUDENT_LEVELS = [
  "beginner",
  "intermediate",
  "upper_intermediate",
  "advanced",
  "elite",
] as const;

export type PoleStudentLevel = (typeof POLE_STUDENT_LEVELS)[number];
export type PoleCatalogLevel = "principiante" | "intermedio" | "avanzado" | "profesional";

export const POLE_STUDENT_LEVEL_LABEL: Record<PoleStudentLevel, string> = {
  beginner: "Principiante",
  intermediate: "Intermedio",
  upper_intermediate: "Intermedio Avanzado",
  advanced: "Avanzado",
  elite: "Élite",
};

export const POLE_CATALOG_LEVEL_LABEL: Record<PoleCatalogLevel, string> = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  profesional: "Profesional",
};

/** Next student level reached when a student passes the evaluation of `level`. */
export const POLE_NEXT_STUDENT_LEVEL: Record<PoleStudentLevel, PoleStudentLevel | null> = {
  beginner: "intermediate",
  intermediate: "upper_intermediate",
  upper_intermediate: "advanced",
  advanced: "elite",
  elite: null,
};

/** Catalog level whose figures a mandatory figure of `level` unlocks (proposal rule). */
export const POLE_KEY_TARGET_LEVEL: Record<PoleStudentLevel, PoleCatalogLevel | null> = {
  beginner: "intermedio",
  intermediate: "intermedio",
  upper_intermediate: "avanzado",
  advanced: "profesional",
  elite: null,
};

export const POLE_DEFAULT_MINIMUM: Record<PoleStudentLevel, number | null> = {
  beginner: 85,
  intermediate: 87,
  upper_intermediate: 90,
  advanced: 92,
  elite: null,
};

export const POLE_MANDATORY_MIN = 4;
export const POLE_MANDATORY_MAX = 5;

export type MandatoryReadiness = "missing" | "proposed" | "partial" | "ready";

/** A level can be evaluated only with 4–5 mandatory figures, all approved by Mike. */
export function mandatoryReadiness(statuses: Array<"proposed" | "approved">): MandatoryReadiness {
  if (statuses.length === 0) return "missing";
  const approved = statuses.filter((status) => status === "approved").length;
  if (approved === 0) return "proposed";
  if (approved >= POLE_MANDATORY_MIN && approved === statuses.length) return "ready";
  return "partial";
}
