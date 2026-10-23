import type { PoleGroupLevel } from "./types";

export type PoleLevelMapRow = {
  level_key: string;
  catalog_level: PoleGroupLevel;
  pro_eligible: boolean;
};

/**
 * Espejo de private.pole_default_catalog_level (migración 20261012220000):
 *   beginner → principiante; intermediate, upper_intermediate → intermedio;
 *   advanced, elite → avanzado (y elegibles para figuras Profesional).
 */
export function defaultPoleLevel(levelKey: string | null | undefined): {
  catalogLevel: PoleGroupLevel | null;
  proEligible: boolean;
} {
  switch (levelKey) {
    case "beginner":
      return { catalogLevel: "principiante", proEligible: false };
    case "intermediate":
    case "upper_intermediate":
      return { catalogLevel: "intermedio", proEligible: false };
    case "advanced":
    case "elite":
      return { catalogLevel: "avanzado", proEligible: true };
    default:
      return { catalogLevel: null, proEligible: false };
  }
}

export function resolvePoleLevel(
  levelKey: string | null | undefined,
  overrides: readonly PoleLevelMapRow[] = [],
) {
  const override = levelKey ? overrides.find((row) => row.level_key === levelKey) : undefined;
  if (override) {
    return { catalogLevel: override.catalog_level, proEligible: override.pro_eligible };
  }
  return defaultPoleLevel(levelKey);
}
