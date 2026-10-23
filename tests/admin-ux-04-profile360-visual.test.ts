import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 · P360-V2 Profile 360 visual homologation", () => {
  const page = source("app/admin/alumnas/[studentId]/page.tsx");
  const header = source("app/admin/alumnas/[studentId]/Profile360Header.tsx");
  const tabs = source("app/admin/alumnas/[studentId]/profile-tabs.ts");
  const styles = source("app/admin/alumnas/profile-360-admin-ux-04.css");
  const layout = source("app/admin/layout.tsx");

  it("scopes the approved visual layer and routes the five P360-V2 tabs", () => {
    expect(page).toContain(
      'className="dashboard-shell profile360-page admin-ux04-profile360 crm-page p360v2"',
    );
    expect(page).toContain("<Profile360Header");
    for (const tab of ["summary", "packages", "progress", "activity", "record"]) {
      expect(page).toContain(`tab === "${tab}"`);
    }
  });

  it("keeps legacy ?view= links working by mapping them to their new tab", () => {
    for (const legacy of [
      "followup",
      "rewards",
      "evaluations",
      "conversation",
      "history",
      "documents",
      "profile",
    ]) {
      expect(tabs).toContain(`  ${legacy}: "`);
    }
  });

  it("keeps the approved identity header and a single level of tabs", () => {
    expect(header).toContain("profile360-approved-header");
    expect(header).toContain("profile360-approved-person");
    expect(header).toContain("profile360-approved-tabs");
    expect(header).not.toContain("crm-operation-tabs");
  });

  it("uses the global premium dark baseline and magenta accent", () => {
    expect(styles).toContain(".admin-ux04-profile360");
    expect(styles).toContain("#ff0a8a");
    expect(styles).toContain(".profile360-approved-person");
    expect(styles).toContain(".profile360-approved-tabs");
    expect(styles).toContain(".profile360-approved-package");
    expect(styles).toContain(".profile360-view-panel");
  });

  it("keeps mobile and desktop responsive layouts", () => {
    expect(styles).toContain("@media (min-width: 1100px)");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (max-width: 430px)");
  });

  it("loads Profile 360 homologation after the existing styles", () => {
    expect(layout).toContain('import "./alumnas/profile-360.css";');
    expect(layout).toContain('import "./alumnas/admin-ux-04.css";');
    expect(layout).toContain('import "./alumnas/profile-360-admin-ux-04.css";');
    expect(layout.indexOf('import "./alumnas/profile-360-admin-ux-04.css";')).toBeGreaterThan(
      layout.indexOf('import "./alumnas/profile-360.css";'),
    );
  });
});
