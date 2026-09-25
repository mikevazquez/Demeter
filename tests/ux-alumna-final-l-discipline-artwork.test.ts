import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL L · discipline artwork", () => {
  const home = source("app/student/page.tsx");
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const admin = source("app/admin/disciplinas/page.tsx");
  const action = source("app/admin/disciplinas/actions.ts");
  const layout = source("app/admin/layout.tsx");

  it("keeps the week calendar only in Reservar", () => {
    expect(home).not.toContain('data-home-block="week-calendar"');
    expect(reserve).toContain('aria-label="Seleccionar fecha"');
  });

  it("lets admin upload optional discipline images", () => {
    expect(admin).toContain("Imágenes de disciplinas");
    expect(admin).toContain('name="cover_image"');
    expect(admin).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(action).toContain('.from("class-artwork")');
    expect(action).toContain("cover_image_path");
    expect(layout).toContain('href: "/admin/disciplinas"');
  });

  it("uses discipline artwork as the visual fallback after session and activity images", () => {
    expect(reserve).toContain("disciplineImageMap.get(session.discipline_id)");
    expect(detail).toContain("disciplineImagePath");
    expect(home).toContain("disciplineArtworkPath");
  });
});
