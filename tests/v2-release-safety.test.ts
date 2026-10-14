import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const stableBlobs: Record<string, string> = {
  // B02 adds only the Candidate confirmation-email guard; baseline parity is proved below.
  "app/auth/actions.ts": "c19527ba0eb7abb5967042a9e0d5d9929847c40b",
  "lib/auth/admin-context.ts": "a7f548fd68204521686dba09eeaed95d11f72254",
  "lib/auth/studio-context-cookie.ts": "ed8605c1d786a8b04b4cd6b799c1853621f3d7d0",
  // d6d4185 added bookingReasonCopyForStudent; the reviewed diff changes no session/auth logic.
  "lib/student/portal.ts": "ca6f4fdfe22ebcd6f76bd63e9272da70cc014195",
  "lib/supabase/proxy.ts": "e05797beb94e42633777e3c1184bc8b909f570f1",
  "lib/supabase/server.ts": "947e71a1258ec1a7441c8815739fae98d1d5682b",
  "lib/supabase/client.ts": "877a8544a6dfbf0618242c861b07e07e6a943d02",
  "lib/supabase/session-policy.ts": "024e5bb64e8a3c85bcab52587a917fe7e02ed803",
  "proxy.ts": "b0f3d25849d1a875f5dbdfeede872d4734e90953",
  "app/login/studio/page.tsx": "bcc5cc2c1ddc9292e5aea9913436a8687d93ddd6",
  "app/login/student/page.tsx": "05d70388462f4ab276552801992ed13b73951b65",
};

function gitBlobSha(path: string) {
  const content = readFileSync(join(process.cwd(), path));
  return createHash("sha1")
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest("hex");
}

describe("Studio Flow V2 release safety", () => {
  it("preserves the entire Auth baseline except the bounded B02 signup-mail guard", () => {
    const source = readFileSync(join(process.cwd(), "app/auth/actions.ts"), "utf8");
    const importDelta =
      'import { assertCandidateRuntimeExternalEffectAllowed } from "@/lib/assistant/external-effect-policy";\n';
    const guardDelta = [
      "  // Auth.signUp can dispatch confirmation email independently of provider keys.",
      "  try {",
      '    assertCandidateRuntimeExternalEffectAllowed("auth_confirmation_email");',
      "  } catch {",
      '    redirect("/setup?error=isolated");',
      "  }",
      "",
      "",
    ].join("\n");
    expect(source.split(importDelta)).toHaveLength(2);
    expect(source.split(guardDelta)).toHaveLength(2);
    const baseline = Buffer.from(source.replace(importDelta, "").replace(guardDelta, ""));
    const sha = createHash("sha1")
      .update(Buffer.from(`blob ${baseline.byteLength}\0`))
      .update(baseline)
      .digest("hex");
    expect(sha).toBe("90a3b8155c458303cdbb4ac9020bca29b52db354");
  });

  it("keeps the stable authentication and session boundary byte-for-byte unchanged", () => {
    for (const [path, sha] of Object.entries(stableBlobs)) {
      expect(gitBlobSha(path), path).toBe(sha);
    }
  });

  it("does not introduce subscription/module gating into the admin V2 release", () => {
    const files = [
      "app/admin/layout.tsx",
      "app/admin/page.tsx",
      "app/admin/agenda/page.tsx",
      "app/admin/alumnas/page.tsx",
      "app/admin/inteligencia/page.tsx",
      "app/admin/integraciones/page.tsx",
    ];
    const source = files.map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");

    for (const forbidden of [
      "current_studio_subscription",
      "current_studio_modules",
      "current_studio_capabilities",
      "allowRestricted",
      "STUDIO_MODULES",
      "hasModule(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
