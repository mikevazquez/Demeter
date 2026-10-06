import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Demi first trial name-first flow", () => {
  const orchestrator = readFileSync(join(process.cwd(), "lib/assistant/orchestrator.ts"), "utf8");
  const route = readFileSync(join(process.cwd(), "app/api/integrations/meta-whatsapp/webhook/route.ts"), "utf8");
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20261006220000_demi_first_trial_name_capture.sql"),
    "utf8",
  );

  it("asks for a name and exits before any booking tools run", () => {
    const guard = orchestrator.indexOf("if (input.identityNeedsName === true)");
    const tools = orchestrator.indexOf("tryServerSidePostTrialEnrollmentMethod(input, trace)");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(tools);
    expect(orchestrator).toContain("¿me compartes tu nombre completo?");
    expect(route).toContain("const identityNeedsName = prepared.identity_needs_name === true;");
    expect(route).toContain("        identityNeedsName,");
    expect(route).toContain("        identityReviewRequired,");
    expect(orchestrator).toContain("input.identityReviewRequired === true");
  });

  it("stores the supplied name on the prospect and prices the first trial at $150", () => {
    expect(migration).toContain("'identity_needs_name', v_identity_needs_name");
    expect(migration).toContain("update public.persons p");
    expect(migration).toContain("miércoles|miercoles");
    expect(migration).toContain("on conflict (studio_id) do nothing");
    expect(migration.match(/'amount_minor',15000/g)).toHaveLength(2);
  });
});
