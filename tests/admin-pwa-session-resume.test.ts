import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin PWA session resume", () => {
  it("gives admin and student installs different start URLs", () => {
    const manifest = source("app/pwa/manifest/route.ts");
    const adminLayout = source("app/admin/layout.tsx");
    const studentLayout = source("app/student/layout.tsx");

    expect(adminLayout).toContain('portal: "admin"');
    expect(studentLayout).toContain('portal: "student"');
    expect(manifest).toContain('const startUrl = portal === "admin" ? "/admin" : "/student"');
    expect(manifest).toContain('start_url: startUrl');
    expect(manifest).toContain('id: "/pwa/" + slug + "/" + portal');
  });

  it("keeps an existing admin session when an old installed PWA reopens /student", () => {
    const portal = source("lib/student/portal.ts");

    expect(portal).toContain('if (!membership) {');
    expect(portal).toContain('redirect("/admin")');
    expect(portal).not.toContain('!account || account.status !== "active" || !membership');
  });
});
