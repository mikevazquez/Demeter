import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const functionFile = "supabase/functions/sf-gov-candidate-denial-probe/index.ts";
const candidateUrl = "https://sdmxtlgjkodidjtvikng.supabase.co";

function exerciseProbe(supabaseUrl: string | undefined, candidateFlag: string | undefined) {
  let handler: (() => Response) | undefined;
  const source = readFileSync(functionFile, "utf8").replace(/^import .*;\s*$/gm, "");
  // Load the actual shared Edge policy: never validate a duplicate implementation.
  const policyLoaded = { exports: {} as Record<string, unknown> };
  const policySource = readFileSync(
    "supabase/functions/_shared/candidate-external-policy.ts",
    "utf8",
  );
  new Function(
    "module",
    "exports",
    transformSync(policySource, { loader: "ts", format: "cjs" }).code,
  )(policyLoaded, policyLoaded.exports);
  const policy = policyLoaded.exports.candidateExternalEffectsBlocked;
  const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const environment = new Map<string, string>();
  if (supabaseUrl !== undefined) environment.set("SUPABASE_URL", supabaseUrl);
  if (candidateFlag !== undefined) environment.set("SF_GOV_CANDIDATE_PREVIEW", candidateFlag);

  new Function("Deno", "candidateExternalEffectsBlocked", compiled)(
    {
      env: { get: (key: string) => environment.get(key) },
      serve: (fn: () => Response) => {
        handler = fn;
      },
    },
    policy,
  );
  if (!handler) throw new Error("candidate_probe_handler_missing");
  return handler();
}

afterEach(() => vi.restoreAllMocks());

describe("SF-OS-001 Candidate Edge denial probe", () => {
  it.each([undefined, "", "0", "1"])(
    "reports PASS for Candidate without requiring flag %s",
    (flag) => {
      const response = exerciseProbe(candidateUrl, flag);
      expect(response.status).toBe(200);
    },
  );

  it.each([undefined, "", "0"])("fails closed for non-Candidate URL with flag %s", (flag) => {
    const response = exerciseProbe("https://hedouonyhynuvwbckdlg.supabase.co", flag);
    expect(response.status).toBe(503);
  });

  it("fails closed when runtime URL is missing", () => {
    expect(exerciseProbe(undefined, undefined).status).toBe(503);
  });
});
