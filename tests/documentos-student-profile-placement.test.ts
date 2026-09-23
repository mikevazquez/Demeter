import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DOCUMENTOS-01 person-centric information architecture", () => {
  const profile = source("app/admin/alumnas/[studentId]/page.tsx");
  const overview = source("app/admin/alumnas/[studentId]/Profile360Overview.tsx");
  const panel = source("app/admin/alumnas/[studentId]/StudentDocumentsPanel.tsx");
  const documentDetail = source("app/admin/documentos/[documentId]/page.tsx");
  const trackingRedirect = source(
    "app/admin/documentos/[documentId]/aceptaciones/page.tsx",
  );
  const evidenceRedirect = source(
    "app/admin/documentos/aceptaciones/[acceptanceId]/page.tsx",
  );

  it("places document status inside the student profile 360", () => {
    expect(overview).toContain('href={href("documents")}');
    expect(overview).toContain("Documentos");
    expect(profile).toContain('view === "documents"');
    expect(profile).toContain("<StudentDocumentsPanel");
    expect(panel).toContain('supabase.rpc("admin_student_document_profile"');
    expect(panel).toContain("Historial de aceptaciones");
  });

  it("keeps document configuration separate from individual tracking", () => {
    expect(documentDetail).not.toContain("/aceptaciones");
    expect(documentDetail).toContain(
      "El detalle por persona se consulta desde el perfil de cada alumna.",
    );
  });

  it("redirects legacy tracking routes back to person-centric surfaces", () => {
    expect(trackingRedirect).toContain('redirect("/admin/documentos/" + documentId)');
    expect(evidenceRedirect).toContain('"?view=documents"');
    expect(evidenceRedirect).toContain('"/admin/alumnas/" + acceptance.student_id');
  });
});
