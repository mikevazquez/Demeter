import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DOCUMENTOS-01 optional consent and document exceptions", () => {
  const reader = source("app/student/documentos/[versionId]/page.tsx");
  const confirmation = source("app/student/documentos/[versionId]/confirmar/page.tsx");
  const result = source("app/student/documentos/confirmacion/page.tsx");
  const migration = source(
    "supabase/migrations/20260923205541_documentos01_optional_consent_and_document_exceptions.sql",
  );

  it("lets students change an optional consent decision", () => {
    expect(reader).toContain("canChangeOptionalDecision");
    expect(reader).toContain("Cambiar decisión");
    expect(confirmation).toContain('name="decision"');
    expect(confirmation).toContain('value="accepted"');
    expect(confirmation).toContain('value="declined"');
    expect(confirmation).toContain("Autorizar");
    expect(confirmation).toContain("No autorizar");
    expect(result).toContain("Respuesta registrada");
    expect(result).toContain('acceptance.decision === "declined"');
  });

  it("stores a new immutable event when an optional decision changes", () => {
    expect(migration).toContain("drop index if exists public.document_acceptances_identity_idx");
    expect(migration).toContain("v_existing_decision=p_decision");
    expect(migration).toContain("'previous_acceptance_id',v_existing");
    expect(migration).toContain("'previous_decision',v_existing_decision");
  });

  it("filters document blockers through active booking exceptions", () => {
    expect(migration).toContain("public.student_booking_exceptions");
    expect(migration).toContain("item->>'version_id'");
    expect(migration).toContain("item->>'document_id'");
    expect(migration).toContain("e.restriction_code = item->>'code'");
  });
});
