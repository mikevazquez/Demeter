import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-07 Movimientos", () => {
  const page = source("app/student/movimientos/page.tsx");

  it("keeps movements read-only and sourced from the canonical student snapshot", () => {
    expect(page).toContain("getStudentPortalContext()");
    expect(page).toContain("snapshot.movements");
    expect(page).not.toContain('.from("credit_ledger")');
    expect(page).not.toContain(".insert(");
    expect(page).not.toContain(".update(");
    expect(page).not.toContain(".delete(");
  });

  it("surfaces the active package summary from canonical acquisition values", () => {
    expect(page).toContain('data-movements-block="summary"');
    expect(page).toContain("activePackage.available_credits");
    expect(page).toContain("activePackage.reserved_credits");
    expect(page).toContain("activePackage.used_credits");
    expect(page).toContain('href="/student/paquete"');
  });

  it("supports all canonical ledger movement types without adding filters or editing controls", () => {
    expect(page).toContain('grant: {');
    expect(page).toContain('reserve: {');
    expect(page).toContain('release: {');
    expect(page).toContain('consume: {');
    expect(page).toContain('adjustment: {');
    expect(page).not.toContain("Filtrar");
    expect(page).not.toContain("<select");
  });

  it("keeps the real movement context visible", () => {
    expect(page).toContain("movement.activity");
    expect(page).toContain("movement.product");
    expect(page).toContain("movement.note");
    expect(page).toContain("movement.created_at");
    expect(page).toContain("movement.quantity");
    expect(page).toContain("formatDateTime");
  });

  it("provides an explicit empty state with a useful existing route", () => {
    expect(page).toContain('data-movements-block="empty"');
    expect(page).toContain("Todavía no hay movimientos");
    expect(page).toContain('activePackage ? "/student/reservar" : "/student/paquete"');
  });

  it("uses the approved dark-magenta student portal language", () => {
    expect(page).toContain("text-fuchsia-300");
    expect(page).toContain("border-fuchsia-500/20");
    expect(page).toContain("bg-white/[0.03]");
    expect(page).toContain('data-movements-block="ledger"');
  });
});
