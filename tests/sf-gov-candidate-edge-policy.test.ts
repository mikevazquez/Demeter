import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

const loaded = { exports: {} as Record<string, unknown> };
new Function(
  "module",
  "exports",
  transformSync(readFileSync("supabase/functions/_shared/candidate-external-policy.ts", "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code,
)(loaded, loaded.exports);

const candidateExternalEffectsBlocked = loaded.exports.candidateExternalEffectsBlocked as (
  flag?: string | null,
  url?: string | null,
) => boolean;

describe("SF-GOV-001 Candidate Edge external effect policy", () => {
  it("denies by Candidate target even when flag is absent, empty or 0", () => {
    for (const flag of [undefined, "", "0"]) {
      expect(
        candidateExternalEffectsBlocked(flag, "https://sdmxtlgjkodidjtvikng.supabase.co"),
      ).toBe(true);
    }
  });

  it("denies misconfigured nonempty Candidate flags", () => {
    expect(candidateExternalEffectsBlocked("true")).toBe(true);
    expect(candidateExternalEffectsBlocked("1")).toBe(true);
  });

  it("preserves non-Candidate Sandbox and production behavior when flag is off", () => {
    for (const ref of ["hedouonyhynuvwbckdlg", "qfhojvgvhrbautvczffq"]) {
      expect(candidateExternalEffectsBlocked("0", `https://${ref}.supabase.co`)).toBe(false);
    }
  });

  it("requires Candidate denial guard in every audited outbound Edge entrypoint", () => {
    for (const path of [
      "create-mercadopago-order",
      "create-demi-mercadopago-order",
      "demi-payment-worker",
      "mercadopago-webhook",
      "reconcile-mercadopago-order",
      "send-push-notification",
      "notification-delivery-worker",
    ]) {
      const source = readFileSync(`supabase/functions/${path}/index.ts`, "utf8");
      expect(source, path).toContain("candidateExternalEffectsBlocked(");
      expect(source, path).toContain('Deno.env.get("SUPABASE_URL")');
    }
  });
});
