import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 portal UX foundation", () => {
  const profile = source("app/student/perfil/page.tsx");
  const layout = source("app/student/layout.tsx");
  const pending = source("app/student/components/PendingActionButton.tsx");
  const notice = source("app/student/components/StudentNoticeDialog.tsx");

  it("shows immediate pending feedback for student form actions", () => {
    expect(pending).toContain("useFormStatus");
    expect(pending).toContain("aria-busy={pending}");
    expect(profile).toContain('pendingLabel="Guardando…"');
    expect(layout).toContain('pendingLabel="Saliendo…"');
  });

  it("uses contextual dialogs for profile success and errors", () => {
    expect(profile).toContain("StudentNoticeDialog");
    expect(profile).toContain('title="Tu correo está actualizado"');
    expect(profile).toContain('title="Revisa tus datos"');
    expect(profile).toContain('dismissHref="/student/perfil"');
    expect(profile).not.toContain("✓ Tus datos se actualizaron correctamente.");
    expect(profile).not.toContain("border-emerald-500/20");
    expect(notice).toContain('role="dialog"');
    expect(notice).toContain('aria-modal="true"');
  });

  it("clears transient query feedback without leaving profile context", () => {
    expect(notice).toContain("router.replace(dismissHref, { scroll: false })");
  });
});
