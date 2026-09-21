import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 Profile 360 visual homologation", () => {
  const page = source("app/admin/alumnas/[studentId]/page.tsx");
  const overview = source("app/admin/alumnas/[studentId]/Profile360Overview.tsx");
  const styles = source("app/admin/alumnas/profile-360-admin-ux-04.css");
  const layout = source("app/admin/layout.tsx");

  it("scopes the approved visual layer without changing Profile 360 flows", () => {
    expect(page).toContain('className="dashboard-shell profile360-page admin-ux04-profile360"');
    expect(page).toContain("<Profile360Overview");
    expect(page).toContain('view === "profile"');
    expect(page).toContain('view === "packages"');
    expect(page).toContain('view === "rewards"');
    expect(page).toContain('view === "followup"');
    expect(page).toContain('view === "history"');
  });

  it("keeps the approved identity, tabs and summary architecture", () => {
    expect(overview).toContain("profile360-approved-header");
    expect(overview).toContain("profile360-approved-person");
    expect(overview).toContain("profile360-approved-tabs");
    expect(overview).toContain("profile360-approved-package");
    expect(overview).toContain("profile360-approved-indicators");
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
