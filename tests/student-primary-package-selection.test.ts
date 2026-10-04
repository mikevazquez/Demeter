import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("student portal primary package selection", () => {
  const portal = source("lib/student/portal.ts");
  const home = source("app/student/page.tsx");
  const packagePage = source("app/student/paquete/page.tsx");
  const movements = source("app/student/movimientos/page.tsx");

  it("prefers an active package with usable credits", () => {
    expect(portal).toContain("selectPrimaryStudentPackage");
    expect(portal).toContain("item.active_now");
    expect(portal).toContain(
      "item.unlimited || (item.available_credits ?? 0) > 0",
    );
    expect(portal).toContain("packages.find((item) => item.active_now)");
  });

  it("ignores reward credit wallets when selecting the main package", () => {
    expect(portal).toContain(
      "acquisitions.filter((item) => !item.reward_credit_wallet)",
    );
  });

  it("uses the same package selector across student portal screens", () => {
    expect(home).toContain(
      "selectPrimaryStudentPackage(snapshot.acquisitions)",
    );
    expect(packagePage).toContain(
      "selectPrimaryStudentPackage(snapshot.acquisitions)",
    );
    expect(movements).toContain(
      "selectPrimaryStudentPackage(snapshot.acquisitions)",
    );
  });
});
