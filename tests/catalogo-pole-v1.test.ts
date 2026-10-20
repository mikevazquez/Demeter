import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Catálogo de figuras Pole v1", () => {
  const page = source("app/admin/catalogo/page.tsx");
  const client = source("app/admin/catalogo/pole-catalog-client.tsx");
  const styles = source("app/admin/catalogo/catalogo.module.css");
  const data = JSON.parse(source("app/admin/catalogo/pole-catalog-data.json")) as {
    figuras: Array<{
      nivel: string;
      programa_base: boolean;
      prerrequisitos_sugeridos: string[];
    }>;
    combos_base: unknown[];
  };
  const more = source("app/admin/mas/page.tsx");

  it("ships the complete artifact dataset and base program", () => {
    expect(data.figuras).toHaveLength(1206);
    expect(data.figuras.filter((figure) => figure.programa_base)).toHaveLength(123);
    expect(data.combos_base).toHaveLength(28);
  });

  it("preserves the approved level distribution", () => {
    const counts = data.figuras.reduce<Record<string, number>>((acc, figure) => {
      acc[figure.nivel] = (acc[figure.nivel] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.Principiante).toBe(129);
    expect(counts.Intermedio).toBe(289);
    expect(counts.Avanzado).toBe(501);
    expect(counts.Profesional).toBe(286);
    expect(counts["Por revisar"]).toBe(1);
  });

  it("keeps v1 read-only and behind evaluation read access", () => {
    expect(page).toContain("CAPABILITIES.EVALUATIONS_READ");
    expect(client).not.toContain("supabase");
    expect(client).not.toContain("fetch(");
    expect(client).not.toContain("form action");
  });

  it("implements base, full catalog and combo views with filters", () => {
    expect(client).toContain("Programa base");
    expect(client).toContain("Catálogo completo");
    expect(client).toContain("Combos base");
    expect(client).toContain('placeholder="Buscar figura (inglés o español)"');
    expect(client).toContain('aria-label="Familia"');
    expect(client).toContain('aria-label="Tipo"');
    expect(client).toContain("prerrequisitos_sugeridos");
  });

  it("keeps Professional visible for consultation without generator behavior", () => {
    expect(client).toContain('"Profesional"');
    expect(client).toContain("queda fuera de cualquier futura");
    expect(client).not.toContain("generateCombo");
  });

  it("is reachable from Admin Más and uses the approved Sendero visual language", () => {
    expect(more).toContain('href: "/admin/catalogo"');
    expect(page).toContain("sendero-catalog");
    expect(styles).toContain("--catalog-accent: #8fe6c8");
    expect(styles).toContain("--lv-p: #8fe6c8");
    expect(styles).toContain('font-family: "Sendero Marcellus"');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
