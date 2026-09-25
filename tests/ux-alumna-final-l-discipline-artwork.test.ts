import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL L · optional class artwork", () => {
  const home = source("app/student/page.tsx");
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const admin = source("app/admin/disciplinas/page.tsx");
  const action = source("app/admin/disciplinas/actions.ts");
  const layout = source("app/admin/layout.tsx");

  it("keeps the full booking calendar in Reservar and a compact weekly strip on Home", () => {
    expect(home).toContain('aria-label="Tu semana"');
    expect(reserve).toContain('aria-label="Seleccionar fecha"');
  });

  it("keeps optional visual configuration available in admin", () => {
    expect(admin).toContain("Imágenes de disciplinas");
    expect(admin).toContain('name="cover_image"');
    expect(admin).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(action).toContain('.from("class-artwork")');
    expect(action).toContain("cover_image_path");
    expect(layout).toContain('href: "/admin/disciplinas"');
  });

  it("uses session artwork, then activity artwork, then the automatic Demeter fallback", () => {
    expect(home).toContain("sessionArtworkPath ?? activityArtworkPath");
    expect(reserve).toContain("sessionMetaMap.get(session.session_id)?.coverImagePath");
    expect(reserve).toContain("style?.coverImagePath ??");
    expect(detail).toContain("sessionImagePath ?? activityImagePath");
    expect(home).not.toContain("disciplineArtworkPath");
    expect(detail).not.toContain("disciplineImagePath");
  });
});
