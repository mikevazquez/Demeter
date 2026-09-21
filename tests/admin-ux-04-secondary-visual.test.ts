import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 secondary admin visual homologation", () => {
  const more = source("app/admin/mas/page.tsx");
  const products = source("app/admin/productos/page.tsx");
  const team = source("app/admin/instructores/page.tsx");
  const automations = source("app/admin/automatizaciones/page.tsx");
  const configuration = source("app/admin/configuracion/page.tsx");
  const rewardsNav = source("app/admin/recompensas/RewardsNav.tsx");
  const styles = source("app/admin/admin-ux-04-secondary.css");
  const layout = source("app/admin/layout.tsx");

  it("scopes the visible secondary destinations to the approved visual system", () => {
    for (const page of [more, products, team, automations, configuration, rewardsNav]) {
      expect(page).toContain("admin-ux04-secondary");
    }
  });

  it("preserves existing secondary-screen capabilities", () => {
    expect(more).toContain("CAPABILITIES.PRODUCTS_READ");
    expect(more).toContain("CAPABILITIES.INSTRUCTORS_READ");
    expect(more).toContain("CAPABILITIES.AUTOMATIONS_READ");
    expect(more).toContain("CAPABILITIES.REWARDS_READ");
    expect(products).toContain('ctx.can("products.write")');
    expect(team).toContain("createInstructor");
    expect(automations).toContain("saveGlobalCommunicationWindowAction");
    expect(configuration).toContain("<PortalIdentityForm");
  });

  it("uses the shared premium dark surfaces and magenta accent", () => {
    expect(styles).toContain(".admin-ux04-secondary");
    expect(styles).toContain("#ff0a8a");
    expect(styles).toContain(".module-list-row");
    expect(styles).toContain(".more-row");
    expect(styles).toContain(".automation-summary-card");
    expect(styles).toContain(".rewards-admin-page");
    expect(styles).toContain(".configuration-page");
  });

  it("keeps mobile behavior responsive and compact", () => {
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain('content: "+"');
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("loads the shared visual layer last in the admin layout", () => {
    expect(layout).toContain('import "./admin-ux-04-secondary.css";');
    expect(layout.indexOf('import "./admin-ux-04-secondary.css";')).toBeGreaterThan(
      layout.indexOf('import "./agenda/session-detail-admin-ux-04.css";'),
    );
  });
});
