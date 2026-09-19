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
  const quickButton = source("app/student/reservar/quick-book-button.tsx");
  const actions = source("app/student/actions.ts");

  it("keeps quick booking in the date-only Reservar schedule", () => {
    const homePage = source("app/student/page.tsx");

    expect(reservePage).toContain("QuickBookButton");
    expect(reservePage).toContain("/student/reservar/${session.session_id}?date=");
    expect(homePage).toContain('href="/student/reservar"');
    expect(homePage).toContain('href="/student/mis-clases"');
    expect(quickButton).toContain("bookStudentSessionInlineAction");
  });

  it("also keeps the explicit detail and confirmation path", () => {
    expect(detailPage).toContain("Reservar clase");
    expect(detailPage).toContain("/confirmar?date=");
    expect(detailPage).not.toContain("bookStudentSessionAction");
    expect(confirmPage).toContain("bookStudentSessionAction");
    expect(confirmPage).toContain("Confirmar reserva");
    expect(confirmPage).toContain('pendingLabel="Reservando…"');
  });

  it("delegates both booking paths to the canonical booking RPC", () => {
    const inlineBlock =
      actions
        .split("export async function bookStudentSessionInlineAction")[1]
        ?.split("export async function bookStudentSessionAction")[0] ?? "";
    const confirmBlock =
      actions
        .split("export async function bookStudentSessionAction")[1]
        ?.split("export async function cancelStudentReservationAction")[0] ?? "";

    expect(inlineBlock).toContain('supabase.rpc("student_book_session"');
    expect(confirmBlock).toContain('supabase.rpc("student_book_session"');
    expect(inlineBlock).not.toContain("credit_ledger");
    expect(confirmBlock).not.toContain("credit_ledger");
  });
});
