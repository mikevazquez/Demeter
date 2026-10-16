import seed from "./catalog-seed.json";
import type { PoleCatalogLevel, PoleFigure } from "./types";

export type PoleSeedFigure = {
  slug: string;
  nombre_original: string;
  nombre_es: string | null;
  nivel: PoleCatalogLevel | "por_revisar";
  tipo: string;
  familia: string;
  programa_base: boolean;
  prerrequisitos: string[];
  requiere_autorizacion: boolean;
  pagina_libro: number | null;
};

export type PoleSeed = {
  version: string;
  fuente: string;
  figuras: PoleSeedFigure[];
  combos_base: { nivel: PoleCatalogLevel; secuencia: string[] }[];
};

export const POLE_CATALOG_SEED = seed as unknown as PoleSeed;

/** Catálogo semilla como figuras (id = slug). Útil para pruebas y vistas previas. */
export function seedFigures(source: PoleSeed = POLE_CATALOG_SEED): PoleFigure[] {
  return source.figuras
    .filter((figure) => figure.nivel !== "por_revisar")
    .map((figure, index) => ({
      id: figure.slug,
      slug: figure.slug,
      name: figure.nombre_es ?? figure.nombre_original,
      original_name: figure.nombre_original,
      level: figure.nivel as PoleCatalogLevel,
      type: figure.tipo,
      family: figure.familia,
      core: figure.programa_base,
      sort_order: index + 1,
      prerequisites: figure.prerrequisitos,
    }));
}
