import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10/N14 student booking UX", () => {
  const reservePage = source("app/student/reservar/page.tsx");
  const detailPage = source("app/student/reservar/[sessionId]/page.tsx");
  const confirmPage = source("app/student/reservar/[sessionId]/confirmar/page.tsx");
  const actions = source("app/student/actions.ts");

  it("keeps the date-only schedule focused on choosing a class", () => {
    const homePage = source("app/student/page.tsx");

    expect(reservePage).not.toContain("QuickBookButton");
    expect(reservePage).toContain("/student/reservar/${session.session_id}?date=");
    expect(homePage).toContain('"/student/reservar"');
    expect(homePage).toContain('"/student/mis-clases"');
  });

  it("uses detail and confirmation as the canonical booking path", () => {
    expect(detailPage).toContain("Reservar esta clase");
    expect(detailPage).toContain("/confirmar?date=");
    expect(detailPage).not.toContain("bookStudentSessionAction");
    expect(confirmPage).toContain("bookStudentSessionAction");
    expect(confirmPage).toContain("Confirma tu clase");
    expect(confirmPage).toContain('pendingLabel="Reservando…"');
  });

  it("delegates final booking to the canonical booking RPC", () => {
    const confirmBlock =
      actions
        .split("export async function bookStudentSessionAction")[1]
        ?.split("export async function cancelStudentReservationAction")[0] ?? "";

    expect(confirmBlock).toContain('supabase.rpc("student_book_session"');
    expect(confirmBlock).not.toContain("credit_ledger");
  });
});
