import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("CLASS-VISUALS optional artwork", () => {
  const migration = source("supabase/migrations/20260925060000_class_artwork_optional.sql");
  const activityWizard = source("app/admin/actividades/ActivityWizard.tsx");
  const activityActions = source("app/admin/actividades/actions.ts");
  const sessionPage = source("app/admin/agenda/[sessionId]/page.tsx");
  const sessionActions = source("app/admin/agenda/[sessionId]/actions.ts");
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const home = source("app/student/page.tsx");

  it("stores optional artwork for activities and one-off session overrides", () => {
    expect(migration).toContain("class_templates");
    expect(migration).toContain("class_sessions");
    expect(migration).toContain("cover_image_path");
    expect(migration).toContain("'class-artwork'");
    expect(migration).toContain("image/jpeg");
    expect(migration).toContain("image/png");
    expect(migration).toContain("image/webp");
  });

  it("lets the studio upload or remove activity artwork", () => {
    expect(activityWizard).toContain('name="cover_image"');
    expect(activityWizard).toContain('name="remove_cover_image"');
    expect(activityWizard).toContain("Imagen opcional para el portal de alumnas");
    expect(activityActions).toContain('from("class-artwork")');
    expect(activityActions).toContain("cover_image_path");
  });

  it("lets the studio override the image for a specific session", () => {
    expect(sessionPage).toContain("Imagen de esta clase");
    expect(sessionPage).toContain("volver a la imagen de la actividad");
    expect(sessionActions).toContain("updateSessionArtwork");
    expect(sessionActions).toContain("sessions/");
  });

  it("uses session image then activity image and keeps an automatic fallback", () => {
    expect(reserve).toContain("sessionMetaMap");
    expect(reserve).toContain("style?.coverImagePath");
    expect(reserve).toContain("disciplineEmoji");
    expect(detail).toContain("sessionImagePath ?? activityImagePath");
    expect(detail).toContain("coverImageUrl");
    expect(home).toContain("artworkSessionMap");
    expect(home).toContain("artworkTemplateMap");
  });

  it("does not make an image mandatory anywhere", () => {
    expect(activityWizard).toContain("(opcional)");
    expect(sessionPage).toContain("Opcional.");
    expect(reserve).toContain("!coverImageUrl");
  });
});
