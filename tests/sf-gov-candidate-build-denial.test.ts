import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const candidate = "https://sdmxtlgjkodidjtvikng.supabase.co";
// Substitute only the public-key trust anchor with a synthetic fixture. The
// verifier and all configuration predicates are the actual shipped script.
const verifier = readFileSync("scripts/verify-deployment-env.mjs", "utf8").replace(
  "3a56e9481c73c7e4a02eed316ac6212763787c6ce39cda8828f40258bea690a6",
  createHash("sha256").update("synthetic-not-a-project-key").digest("hex"),
);
const isolated = {
  ...process.env,
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "governance/sf-gov-001-release-gates",
  NEXT_PUBLIC_SUPABASE_URL: candidate,
  SUPABASE_URL: candidate,
  SF_GOV_CANDIDATE_PREVIEW: "1",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-not-a-project-key",
  SUPABASE_SERVICE_ROLE_KEY: "sf-gov-disabled",
  OPENAI_API_KEY: "sf-gov-disabled",
  MERCADOPAGO_ACCESS_TOKEN: "sf-gov-disabled",
};

describe("B02 Candidate Preview build gate", () => {
  it("accepts the isolated fixture before applying each negative mutation", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", verifier], {
      env: isolated,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("providers and service role disabled");
  });
  it.each([
    { SUPABASE_SERVICE_ROLE_KEY: "inherited-test-token" },
    { OPENAI_API_KEY: "inherited-test-token" },
    { MERCADOPAGO_ACCESS_TOKEN: "inherited-test-token" },
    { SUPABASE_URL: "https://qfhojvgvhrbautvczffq.supabase.co" },
    { SF_GOV_CANDIDATE_PREVIEW: "0" },
    { VERCEL_GIT_COMMIT_REF: "unapproved-branch" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "incorrect-project-key" },
  ])("rejects incomplete or untrusted Candidate configuration: %j", (override) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", verifier], {
      env: {
        ...isolated,
        ...override,
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Candidate Preview configuration is not isolated");
    expect(result.stderr).not.toContain("inherited-test-token");
  });

  it("refuses a production build targeted at Candidate", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-deployment-env.mjs"], {
      env: { ...process.env, VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: candidate },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
  });
});
