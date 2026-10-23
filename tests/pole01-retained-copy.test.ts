import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loader = readFileSync(new URL("../lib/pole/retained.ts", import.meta.url), "utf8");
const portal = readFileSync(new URL("../app/student/figuras/page.tsx", import.meta.url), "utf8");
const profile = readFileSync(
  new URL("../app/admin/alumnas/[studentId]/StudentFiguresPanel.tsx", import.meta.url),
  "utf8",
);

describe("POLE-01-18 retained promotion is visible", () => {
  it("reads only the active retention", () => {
    expect(loader).toContain('.eq("status", "retained")');
    expect(loader).toContain("Falta ");
  });

  it("is shown in the student portal and in the admin profile", () => {
    expect(portal).toContain("loadPoleRetainedPromotion");
    expect(profile).toContain("loadPoleRetainedPromotion");
  });
});
