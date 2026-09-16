import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student home visual hierarchy", () => {
  const home = source("app/student/page.tsx");

  it("prioritizes booked classes before the date carousel", () => {
    expect(home).toContain('snapshot.upcoming.length ? "order-1" : "order-2"');
    expect(home).toContain("Próximas clases");
    expect(home).toContain("Tu agenda");
  });

  it("prioritizes the date carousel when there are no booked classes", () => {
    expect(home).toContain('snapshot.upcoming.length ? "order-2" : "order-1"');
    expect(home).toContain("Clases del día");
    expect(home).toContain('className="flex flex-col gap-6"');
  });

  it("keeps statistics after agenda and date discovery", () => {
    expect(home).toContain('className="order-3 rounded-3xl');
    expect(home).toContain("Estadísticas");
  });
});
