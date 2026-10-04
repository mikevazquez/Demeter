import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const stableBlobs: Record<string, string> = {
  "app/auth/actions.ts": "90a3b8155c458303cdbb4ac9020bca29b52db354",
  "lib/auth/admin-context.ts": "a7f548fd68204521686dba09eeaed95d11f72254",
  "lib/auth/studio-context-cookie.ts": "ed8605c1d786a8b04b4cd6b799c1853621f3d7d0",
  "lib/student/portal.ts": "7de9938908a09254f415160b6a61f29c5d1e9324",
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
