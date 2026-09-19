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

  it("keeps class discovery in Reservar and removes direct quick booking", () => {
    const homePage = source("app/student/page.tsx");

    expect(reservePage).not.toContain("QuickBookButton");
    expect(reservePage).toContain("/student/reservar/${session.session_id}?date=");
    expect(homePage).toContain('href="/student/reservar"');
    expect(homePage).toContain('href="/student/mis-clases"');
  });

  it("uses an explicit detail and confirmation step before mutation", () => {
    expect(detailPage).toContain("Reservar clase");
    expect(detailPage).toContain("/confirmar?date=");
    expect(detailPage).not.toContain("bookStudentSessionAction");
    expect(confirmPage).toContain("bookStudentSessionAction");
    expect(confirmPage).toContain("Confirmar reserva");
    expect(confirmPage).toContain('pendingLabel="Reservando…"');
  });

  it("still delegates the mutation to the canonical booking RPC", () => {
    const block =
      actions
        .split("export async function bookStudentSessionAction")[1]
        ?.split("export async function cancelStudentReservationAction")[0] ?? "";

    expect(block).toContain('supabase.rpc("student_book_session"');
    expect(block).not.toContain("credit_ledger");
    expect(block).not.toContain("product_acquisitions");
  });
});
