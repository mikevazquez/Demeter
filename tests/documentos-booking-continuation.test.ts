import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DOCUMENTOS-01 booking continuation", () => {
  const blocker = source("app/student/reservar/BookingRestrictionCard.tsx");
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const confirm = source("app/student/reservar/[sessionId]/confirmar/page.tsx");
  const read = source("app/student/documentos/[versionId]/page.tsx");
  const documentConfirm = source("app/student/documentos/[versionId]/confirmar/page.tsx");
  const actions = source("app/student/documentos/actions.ts");
  const domain = source("lib/documents.ts");

  it("adds a safe return target only to document blockers", () => {
    expect(blocker).toContain('item.action_kind === "documents" && returnTo');
    expect(blocker).toContain("returnTo=\${encodeURIComponent(returnTo)}");
    expect(domain).toContain('candidate.startsWith("/student/reservar")');
  });

  it("preserves list, session detail and confirmation booking targets", () => {
    expect(reserve).toContain("returnTo={\`/student/reservar?date=\${selectedDate}\`}");
    expect(detail).toContain(
      "returnTo={\`/student/reservar/\${session.session_id}?date=\${returnDate}\`}",
    );
    expect(confirm).toContain("/confirmar?date=\${returnDate}");
    expect(confirm).toContain("selectedResource.resource_id");
  });

  it("carries the booking target through reading and acceptance", () => {
    expect(read).toContain("safeReservationReturnTo(query.returnTo)");
    expect(read).toContain("Continuar a la confirmación");
    expect(documentConfirm).toContain('name="return_to"');
    expect(documentConfirm).toContain("safeReservationReturnTo(query.returnTo)");
  });

  it("continues with the next document or resumes the original booking", () => {
    expect(actions).toContain('item.action_kind === "documents" && item.action_href');
    expect(actions).toContain("redirect(nextHref)");
    expect(actions).toContain("if (returnTo)");
    expect(actions).toContain("redirect(returnTo)");
  });
});
