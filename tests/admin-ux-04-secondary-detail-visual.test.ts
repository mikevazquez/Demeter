import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 secondary detail/editor visual homologation", () => {
  const productDetail = source("app/admin/productos/[productId]/page.tsx");
  const productEdit = source("app/admin/productos/[productId]/editar/page.tsx");
  const productNew = source("app/admin/productos/nuevo/page.tsx");
  const instructorDetail = source("app/admin/instructores/[instructorId]/page.tsx");
  const automationDetail = source("app/admin/automatizaciones/[code]/page.tsx");
  const rewardsNav = source("app/admin/recompensas/RewardsNav.tsx");
  const styles = source("app/admin/admin-ux-04-secondary-detail.css");
  const layout = source("app/admin/layout.tsx");

  it("scopes product, team and automation internal screens", () => {
    expect(productDetail).toContain("admin-ux04-secondary-detail product-detail-page");
    expect(productEdit).toContain("admin-ux04-secondary-detail product-editor-page");
    expect(productNew).toContain("admin-ux04-secondary-detail product-editor-page");
    expect(instructorDetail).toContain("admin-ux04-secondary-detail team-detail-page");
    expect(automationDetail).toContain("admin-ux04-secondary-detail automation-detail-page");
  });

  it("keeps Rewards internal screens under the shared approved shell", () => {
    expect(rewardsNav).toContain("admin-ux04-secondary rewards-admin-page");
    expect(styles).toContain(".rewards-admin-page form");
    expect(styles).toContain(".rewards-admin-page input");
  });

  it("preserves existing actions and operational behavior", () => {
    expect(productDetail).toContain("duplicateProduct");
    expect(productDetail).toContain("setProductActive");
    expect(productEdit).toContain("updateProduct");
    expect(productNew).toContain("createProduct");
    expect(instructorDetail).toContain("setInstructorStatus");
    expect(instructorDetail).toContain("InstructorAccessProvisioner");
    expect(automationDetail).toContain("activateAutomationAction");
    expect(automationDetail).toContain("pauseAutomationAction");
    expect(automationDetail).toContain("archiveAutomationAction");
  });

  it("uses the approved dark premium and magenta baseline", () => {
    expect(styles).toContain(".admin-ux04-secondary-detail");
    expect(styles).toContain("#ff0a8a");
    expect(styles).toContain(".product-detail-page");
    expect(styles).toContain(".product-editor-page");
    expect(styles).toContain(".team-detail-page");
    expect(styles).toContain(".automation-detail-page");
    expect(styles).toContain(".rewards-admin-page");
  });

  it("keeps mobile layouts compact", () => {
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("loads after the secondary root visual layer", () => {
    expect(layout).toContain('import "./admin-ux-04-secondary.css";');
    expect(layout).toContain('import "./admin-ux-04-secondary-detail.css";');
    expect(layout.indexOf('import "./admin-ux-04-secondary-detail.css";')).toBeGreaterThan(
      layout.indexOf('import "./admin-ux-04-secondary.css";'),
    );
  });
});
