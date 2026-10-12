import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const stableBlobs: Record<string, string> = {
  // SaaS recovery extends activation to owner/admin; functional action tests cover all three roles.
  // Session policy, portal cookies, password validation and sign-out behavior remain unchanged.
  "app/auth/actions.ts": "b0221a8cd2d215ea1198488d6004ba82a14e5481",
  // SaaS recovery applies studio entitlements after membership validation.
  // saas-plan-context tests ensure provider failures/restrictions never sign users out.
  "lib/auth/admin-context.ts": "51c50f15407cfdcaa63eacbf5fe0c45ff3d001f1",
  "lib/auth/studio-context-cookie.ts": "ed8605c1d786a8b04b4cd6b799c1853621f3d7d0",
  // d6d4185 added bookingReasonCopyForStudent; the reviewed diff changes no session/auth logic.
  "lib/student/portal.ts": "ca6f4fdfe22ebcd6f76bd63e9272da70cc014195",
  "lib/supabase/proxy.ts": "e05797beb94e42633777e3c1184bc8b909f570f1",
  "lib/supabase/server.ts": "f17966a19829dda7433caed20788e1b0669e3f9d",
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
  it("keeps the reviewed authentication and session boundary versions", () => {
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
