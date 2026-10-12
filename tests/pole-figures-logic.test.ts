import { describe, expect, it } from "vitest";

import {
  generateCombo,
  groupStudentsByLevel,
  joinNames,
  type ComboStudent,
} from "@/lib/pole/combo-generator";
import {
  ancestorsOf,
  childrenOf,
  figureStatus,
  groupByFamily,
  summarizeForStudent,
  type PoleStateContext,
} from "@/lib/pole/figure-state";
import { POLE_CATALOG_SEED, seedFigures } from "@/lib/pole/seed";
import type { StudentPoleFigure } from "@/lib/pole/types";

const figures = seedFigures();
const byId = new Map(figures.map((figure) => [figure.id, figure]));

// Datos del prototipo aprobado (Ana, Sofía, Valeria).
const ANA = [
  "pole-squat",
  "step-around",
  "pirouette",
  "ballerina-upright",
  "basic-fireman",
  "firelady",
  "front-hook",
  "back-hook",
  "attitude-spin",
  "chair",
  "carousel",
  "boomerang",
  "basic-climb",
  "cradle",
  "side-spin",
];
const SOFIA = [
  "pole-squat",
  "step-around",
  "ballerina-upright",
  "basic-fireman",
  "front-hook",
  "back-hook",
  "chair",
  "carousel",
  "basic-climb",
  "cradle",
  "side-spin",
];
const VALERIA = [
  ...figures
    .filter((f) => f.core && (f.level === "principiante" || f.level === "intermedio"))
    .map((f) => f.id),
  "shoulder-mount-progressions",
  "recliner-invert-tuck",
  "allegra-closed",
  "jade",
  "ayesha-elbow",
  "jacknife-split",
];

function student(id: string, name: string, level: ComboStudent["level"], achieved: string[]) {
  return { id, name, level, achieved: new Set(achieved) } satisfies ComboStudent;
}

function context(
  achieved: string[],
  level: PoleStateContext["studentLevel"],
  authorized: string[] = [],
) {
  return { achieved: new Set(achieved), authorized: new Set(authorized), studentLevel: level };
}

describe("catálogo semilla", () => {
  it("trae el programa base completo y las figuras Profesional", () => {
    expect(POLE_CATALOG_SEED.figuras).toHaveLength(1206);
    expect(figures.filter((f) => f.core)).toHaveLength(123);
    expect(figures.filter((f) => f.core && f.level === "principiante")).toHaveLength(48);
    expect(figures.filter((f) => f.core && f.level === "intermedio")).toHaveLength(50);
    expect(figures.filter((f) => f.core && f.level === "avanzado")).toHaveLength(25);
    expect(figures.filter((f) => f.level === "profesional")).toHaveLength(286);
    expect(POLE_CATALOG_SEED.combos_base).toHaveLength(28);
  });

  it("sólo referencia prerrequisitos que existen y no tiene ciclos", () => {
    for (const figure of figures) {
      for (const id of figure.prerequisites) expect(byId.has(id)).toBe(true);
      expect(ancestorsOf(figure.id, byId)).not.toContain(figure.id);
    }
  });

  it("no incluye textos del libro: sólo nombre, nivel, familia y página", () => {
    const keys = new Set(POLE_CATALOG_SEED.figuras.flatMap((figure) => Object.keys(figure)));
    expect([...keys].sort()).toEqual(
      [
        "familia",
        "nivel",
        "nombre_es",
        "nombre_original",
        "pagina_libro",
        "prerrequisitos",
        "programa_base",
        "requiere_autorizacion",
        "slug",
        "tipo",
      ].sort(),
    );
  });
});

describe("estado de una figura para la alumna", () => {
  const ana = context(ANA, "principiante");

  it("lograda, disponible, bloqueada y siguiente nivel", () => {
    expect(figureStatus(byId.get("chair")!, ana).state).toBe("lograda");
    expect(figureStatus(byId.get("pike-fireman")!, ana)).toMatchObject({
      state: "disponible",
      availability: "siguiente",
    });
    expect(figureStatus(byId.get("step-and-slide")!, ana)).toMatchObject({
      state: "disponible",
      availability: "libre",
    });
    expect(figureStatus(byId.get("dropped-tuck-spin")!, ana)).toEqual({
      state: "bloqueada",
      missing: ["tuck-spin-cradle"],
    });
    expect(figureStatus(byId.get("basic-invert")!, ana).state).toBe("siguiente_nivel");
  });

  it("mariposa extendida queda bloqueada sin mariposa", () => {
    const intermedia = context(["basic-invert"], "intermedio");
    expect(figureStatus(byId.get("extended-butterfly")!, intermedia)).toEqual({
      state: "bloqueada",
      missing: ["butterfly"],
    });
    expect(ancestorsOf("extended-butterfly", byId)).toEqual(
      expect.arrayContaining(["butterfly", "basic-invert", "handstand-butterfly"]),
    );
    const chain = ancestorsOf("extended-butterfly", byId);
    expect(chain.indexOf("basic-climb")).toBeLessThan(chain.indexOf("butterfly"));
  });

  it("Profesional sólo se abre con autorización", () => {
    expect(figureStatus(byId.get("reverse-ayesha")!, context([], "avanzado")).state).toBe(
      "requiere_autorizacion",
    );
    expect(
      figureStatus(byId.get("reverse-ayesha")!, context([], "avanzado", ["reverse-ayesha"])).state,
    ).toBe("autorizada");
  });

  it("el contador cuenta sólo el programa base de su nivel", () => {
    const summary = summarizeForStudent(figures as StudentPoleFigure[], ana);
    expect(summary).toMatchObject({ done: 15, total: 48 });
    expect(summary.next.map((f) => f.id)).toContain("pike-fireman");
    expect(summary.blocked.map((b) => b.figure.id)).toContain("dropped-tuck-spin");
    expect(summary.pro.locked).toHaveLength(286);
  });

  it("childrenOf y groupByFamily", () => {
    expect(childrenOf("butterfly", figures).map((f) => f.id)).toContain("extended-butterfly");
    const families = groupByFamily(figures.filter((f) => f.level === "profesional"));
    expect(families[0]).toMatchObject({ family: "Flexibilidad extrema" });
    expect(families[0].items).toHaveLength(78);
  });
});

describe("generador de combos", () => {
  const ana = student("ana", "Ana", "principiante", ANA);
  const sofia = student("sofia", "Sofía", "principiante", SOFIA);
  const valeria = student("valeria", "Valeria", "avanzado", VALERIA);

  it("agrupa por nivel y manda a las que no tienen evaluación con principiantes", () => {
    const sinNivel = student("luz", "Luz", null, []);
    const groups = groupStudentsByLevel([ana, valeria, sofia, sinNivel]);
    expect(groups.map((g) => g.level)).toEqual(["principiante", "avanzado"]);
    expect(groups[0].students.map((s) => s.id)).toEqual(["ana", "sofia", "luz"]);
    expect(groups[0].withoutLevel.map((s) => s.id)).toEqual(["luz"]);
  });

  it("reproduce el combo del prototipo para principiantes", () => {
    const [group] = groupStudentsByLevel([ana, sofia]);
    const combo = generateCombo(group, figures, 0)!;
    expect(combo.newFigureId).toBe("pike-fireman");
    expect(combo.prerequisiteId).toBe("basic-fireman");
    expect(combo.sequence[0]).toBe("basic-fireman");
    expect(combo.sequence[1]).toBe("pike-fireman");
    expect(combo.sequence.length).toBeGreaterThanOrEqual(3);
    expect(combo.sequence.length).toBeLessThanOrEqual(4);
    expect(combo.explanation).toBe(
      "Ana y Sofía ya saben Bombero básico, que es el paso previo de Bombero en pike, así que hoy pueden intentarla.",
    );
  });

  it("la figura nueva no la tiene nadie y su paso previo lo tienen todas", () => {
    const [group] = groupStudentsByLevel([ana, sofia]);
    for (let k = 0; k < 30; k += 1) {
      const combo = generateCombo(group, figures, k)!;
      const nueva = byId.get(combo.newFigureId)!;
      expect(nueva.level).toBe("principiante");
      expect(ana.achieved.has(nueva.id) || sofia.achieved.has(nueva.id)).toBe(false);
      for (const id of nueva.prerequisites) {
        expect(ana.achieved.has(id) && sofia.achieved.has(id)).toBe(true);
      }
      for (const id of combo.sequence.filter((id) => id !== nueva.id)) {
        expect(ana.achieved.has(id) && sofia.achieved.has(id)).toBe(true);
      }
      expect(new Set(combo.sequence).size).toBe(combo.sequence.length);
    }
  });

  it("'Otra opción' rota entre todas las candidatas", () => {
    const [group] = groupStudentsByLevel([ana, sofia]);
    const first = generateCombo(group, figures, 0)!;
    const seen = new Set<string>();
    for (let k = 0; k < first.total; k += 1)
      seen.add(generateCombo(group, figures, k)!.newFigureId);
    expect(seen.size).toBe(first.total);
    expect(generateCombo(group, figures, first.total)!.newFigureId).toBe(first.newFigureId);
  });

  it("nunca usa figuras Profesional y respeta singular en grupos de una", () => {
    const [group] = groupStudentsByLevel([valeria]);
    for (let k = 0; k < 20; k += 1) {
      const combo = generateCombo(group, figures, k)!;
      for (const id of combo.sequence) expect(byId.get(id)!.level).not.toBe("profesional");
      expect(combo.explanation).toContain("Valeria ya sabe");
      expect(combo.explanation).toContain("puede intentarla");
    }
  });

  it("devuelve null cuando no hay figuras nuevas", () => {
    const todo = student(
      "x",
      "X",
      "principiante",
      figures.filter((f) => f.level === "principiante").map((f) => f.id),
    );
    const [group] = groupStudentsByLevel([todo]);
    expect(generateCombo(group, figures, 0)).toBeNull();
  });

  it("joinNames", () => {
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Sofía"])).toBe("Ana y Sofía");
    expect(joinNames(["Ana", "Sofía", "Luz"])).toBe("Ana, Sofía y Luz");
  });
});
