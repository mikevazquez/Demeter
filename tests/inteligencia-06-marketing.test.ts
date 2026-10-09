import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-06 marketing attribution", () => {
  const migration = source(
    "supabase/migrations/20260926125000_inteligencia06_marketing_attribution.sql",
  );
  const actions = source("app/admin/inteligencia/actions.ts");

  it("adds optional campaign attribution to advertising spend", () => {
    expect(migration).toContain("marketing_source text");
    expect(migration).toContain("marketing_campaign text");
    expect(migration).toContain("studio_expenses_marketing_attribution_idx");
    expect(actions).toContain("marketing_source");
    expect(actions).toContain('category === "advertising"');
  });
});
