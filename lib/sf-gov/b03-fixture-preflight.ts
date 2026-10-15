/**
 * B03 fixture preflight: deterministic NO-WRITE validator. It never creates
 * tenants, users, sessions, credentials or external traffic.
 */
export const B03_CANDIDATE_REF = "sdmxtlgjkodidjtvikng";

export type FixturePreflight = {
  targetUrl: string;
  expectedSha: string;
  observedSha: string;
  emails: readonly string[];
  outboundDenied: boolean;
  authAdminProvisioningVerified: boolean;
  cleanupPlanVerified: boolean;
  productionPromotionRequested: boolean;
};

export function evaluateB03FixtureReadiness(input: FixturePreflight): {
  ready: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  let target: URL | undefined;
  try {
    target = new URL(input.targetUrl);
  } catch {
    reasons.push("invalid_target");
  }
  if (
    !target ||
    target.origin !== `https://${B03_CANDIDATE_REF}.supabase.co` ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    reasons.push("candidate_target_required");
  }
  if (!/^[a-f0-9]{40}$/.test(input.expectedSha) || input.expectedSha !== input.observedSha) {
    reasons.push("sha_mismatch");
  }
  if (
    !input.emails.length ||
    input.emails.some(
      (email) =>
        !/^sf-gov-b03-[a-z0-9-]+@auth\.studioflow\.invalid$/.test(email) ||
        email.length > 128,
    ) ||
    new Set(input.emails).size !== input.emails.length
  ) {
    reasons.push("synthetic_identity_allowlist_required");
  }
  if (!input.outboundDenied) reasons.push("outbound_not_certified");
  if (!input.authAdminProvisioningVerified) reasons.push("auth_admin_method_not_verified");
  if (!input.cleanupPlanVerified) reasons.push("cleanup_not_verified");
  if (input.productionPromotionRequested) reasons.push("production_forbidden");
  return { ready: reasons.length === 0, reasons };
}
