import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi last-minute booking contract", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const reads = source("lib/assistant/read-tools.ts");

  it("keeps scheduled sessions bookable through their start minute", () => {
    expect(actions).toContain("Math.floor(now / 60_000) * 60_000");
    expect(actions).toContain("new Date(session.starts_at).getTime() >= currentMinuteStart(now)");
  });

  it("shows classes until the start minute and drops only older starts", () => {
    expect(reads).toContain("const earliestBookableStart = currentMinuteStart();");
    expect(reads).toContain(
      "if (new Date(session.starts_at).getTime() < earliestBookableStart) continue;",
    );
    expect(reads).not.toContain("Date.now() + 30 * 60_000");
  });
});
