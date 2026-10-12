export type PoleCatalogLevel = "principiante" | "intermedio" | "avanzado" | "profesional";
export type PoleGroupLevel = Exclude<PoleCatalogLevel, "profesional">;

export const POLE_LEVEL_LABEL: Record<PoleCatalogLevel, string> = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  profesional: "Profesional",
};

export const POLE_LEVEL_RANK: Record<PoleCatalogLevel, number> = {
  principiante: 1,
  intermedio: 2,
  avanzado: 3,
  profesional: 4,
};

export type PoleFigure = {
  id: string;
  slug: string;
  /** Nombre visible (español cuando existe; si no, el original). */
  name: string;
  original_name: string;
  description?: string | null;
  level: PoleCatalogLevel;
  type: string;
  family: string;
  core: boolean;
  sort_order: number;
  prerequisites: string[];
};

export type PoleAchievement = {
  source: "student" | "instructor";
  achieved_at: string;
  validated_at: string | null;
  class_session_id: string | null;
  photo_path: string | null;
};

export type StudentPoleFigure = PoleFigure & {
  achievement: PoleAchievement | null;
  authorized: boolean;
};

export type StudentPoleLevel = {
  key: string;
  title: string;
  catalog_level: PoleGroupLevel;
  pro_eligible: boolean;
};

export type StudentPoleCatalog = {
  student_id?: string;
  discipline: { id: string; name: string } | null;
  level: StudentPoleLevel | null;
  figures: StudentPoleFigure[];
};
