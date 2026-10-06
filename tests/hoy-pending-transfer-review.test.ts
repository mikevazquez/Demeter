import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Hoy pending transfer reviews", () => {
  const page = source("app/admin/page.tsx");
  const css = source("app/admin/hoy.css");

  it("loads only provisional transfer purchases for review", () => {
    expect(page).toContain('from("assistant_transfer_purchase_intents")');
    expect(page).toContain('.eq("status", "provisional_active")');
  });

  it("links each pending payment to the student's existing transfer review UI", () => {
    expect(page).toContain("?view=packages#transferencias");
    expect(page).toContain("pago por validar");
  });

  it("renders a visually important Hoy card", () => {
    expect(page).toContain('className="hoy-priority"');
    expect(css).toContain(".hoy-priority");
    expect(css).toContain(".hoy-priority-item");
  });
});
