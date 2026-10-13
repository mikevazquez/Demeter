import { describe, expect, it } from "vitest";

import { assertServiceTargetIsolation } from "@/lib/supabase/target-policy";

const sandbox = "https://hedouonyhynuvwbckdlg.supabase.co";
const production = "https://qfhojvgvhrbautvczffq.supabase.co";
const candidate = "https://sdmxtlgjkodidjtvikng.supabase.co";

describe("SF-GOV-001 Preview service role isolation", () => {
  it("allows the historical Sandbox target in generic Preview", () => {
    expect(() =>
      assertServiceTargetIsolation({ url: sandbox, vercelEnv: "preview" }),
    ).not.toThrow();
  });

  it("blocks production as a Preview service-role target", () => {
    expect(() => assertServiceTargetIsolation({ url: production, vercelEnv: "preview" })).toThrow(
      "preview_service_target_production_forbidden",
    );
  });

  it("blocks Candidate from inheriting a generic Preview service-role key", () => {
    expect(() =>
      assertServiceTargetIsolation({
        url: candidate,
        vercelEnv: "preview",
        candidatePreview: "1",
      }),
    ).toThrow("candidate_preview_service_role_not_certified");
  });

  it("rejects unknown Preview projects and malformed targets", () => {
    expect(() => assertServiceTargetIsolation({ url: candidate, vercelEnv: "preview" })).toThrow(
      "preview_service_target_unapproved",
    );
    expect(() => assertServiceTargetIsolation({ url: "not-a-url", vercelEnv: "preview" })).toThrow(
      "preview_service_target_invalid",
    );
  });

  it("does not alter existing production runtime behavior", () => {
    expect(() =>
      assertServiceTargetIsolation({ url: production, vercelEnv: "production" }),
    ).not.toThrow();
  });
});
