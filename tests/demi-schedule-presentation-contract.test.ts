import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi schedule presentation", () => {
  const readTools = source("lib/assistant/read-tools.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");

  it("does not expose exact class capacity or remaining seats to the model", () => {
    const scheduleSection = readTools.slice(
      readTools.indexOf("export async function searchClassAvailability"),
      readTools.indexOf("export async function getActivityCatalog"),
    );

    expect(scheduleSection).not.toContain("capacity: session.capacity");
    expect(scheduleSection).not.toContain("spots_available:");
    expect(scheduleSection).toContain("is_full: available <= 0");
  });

  it("tells Demi not to show seat counts in schedule lists", () => {
    expect(orchestrator).toContain(
      "no muestres números de cupos, lugares disponibles ni capacidad",
    );
  });
});
