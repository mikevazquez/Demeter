import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student quick booking UX", () => {
  it("lets the student reserve from schedule and home cards without opening detail", () => {
    const reservePage = source("app/student/reservar/page.tsx");
    const homePage = source("app/student/page.tsx");
    const quickButton = source("app/student/reservar/quick-book-button.tsx");

    expect(reservePage).toContain("QuickBookButton");
    expect(reservePage).toContain("Ver detalles");
    expect(homePage).toContain("QuickBookButton");
    expect(homePage).toContain("Ver detalles");
    expect(quickButton).toContain('"Reservar"');
    expect(quickButton).toContain("bookStudentSessionInlineAction");
  });

  it("keeps the student on the selected schedule and shows an inline confirmation", () => {
    const quickButton = source("app/student/reservar/quick-book-button.tsx");

    expect(quickButton).toContain("Reserva confirmada");
    expect(quickButton).toContain("¡Tu lugar está listo!");
    expect(quickButton).toContain("router.refresh()");
    expect(quickButton).not.toContain("router.push(");
    expect(quickButton).toContain("reservar otra clase del mismo día");
  });

  it("still delegates eligibility and credit mutations to the canonical booking RPC", () => {
    const actions = source("app/student/actions.ts");
    const inlineBlock =
      actions
        .split("export async function bookStudentSessionInlineAction")[1]
        ?.split("export async function bookStudentSessionAction")[0] ?? "";

    expect(inlineBlock).toContain('supabase.rpc("student_book_session"');
    expect(inlineBlock).not.toContain("credit_ledger");
    expect(inlineBlock).not.toContain("product_acquisitions");
    expect(inlineBlock).not.toContain("redirect(");
  });
});
