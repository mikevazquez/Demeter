import { describe, expect, it } from "vitest";

import { evaluateB03FixtureReadiness } from "@/lib/sf-gov/b03-fixture-preflight";

const sha = "a".repeat(40);
const safe = {
  targetUrl: "https://sdmxtlgjkodidjtvikng.supabase.co/",
  expectedSha: sha,
  observedSha: sha,
  emails: [
    "sf-gov-b03-admin@auth.studioflow.invalid",
    "sf-gov-b03-student@auth.studioflow.invalid",
  ],
  outboundDenied: true,
  authAdminProvisioningVerified: true,
  cleanupPlanVerified: true,
  productionPromotionRequested: false,
};

describe("B03 candidate fixture no-write preflight", () => {
  it("accepts an entirely certified synthetic manifest without performing any operation", () => {
    expect(evaluateB03FixtureReadiness(safe)).toEqual({ ready: true, reasons: [] });
  });

  it.each([
    ["production", { targetUrl: "https://qfhojvgvhrbautvczffq.supabase.co/" }],
    ["sandbox", { targetUrl: "https://hedouonyhynuvwbckdlg.supabase.co/" }],
    ["target suffix", { targetUrl: "https://sdmxtlgjkodidjtvikng.supabase.co.attacker.invalid/" }],
    ["URL with credentials", { targetUrl: "https://user:secret@sdmxtlgjkodidjtvikng.supabase.co/" }],
    ["URL with path", { targetUrl: "https://sdmxtlgjkodidjtvikng.supabase.co/auth/v1/admin" }],
    ["wrong commit", { observedSha: "b".repeat(40) }],
    ["bad SHA", { expectedSha: "main" }],
    ["real email", { emails: ["someone@gmail.com"] }],
    ["duplicate identities", { emails: [safe.emails[0], safe.emails[0]] }],
    ["no identities", { emails: [] }],
    ["outbound not verified", { outboundDenied: false }],
    ["Auth method not verified", { authAdminProvisioningVerified: false }],
    ["cleanup not verified", { cleanupPlanVerified: false }],
    ["production requested", { productionPromotionRequested: true }],
  ])("rejects %s", (_name, override) => {
    const result = evaluateB03FixtureReadiness({ ...safe, ...override });
    expect(result.ready).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("rejects today's actual unverified Auth/outbound setup", () => {
    const result = evaluateB03FixtureReadiness({
      ...safe,
      authAdminProvisioningVerified: false,
      outboundDenied: false,
      cleanupPlanVerified: false,
    });
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("auth_admin_method_not_verified");
  });
});
