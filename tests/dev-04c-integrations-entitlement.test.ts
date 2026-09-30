import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04C integrations entitlement", () => {
  const migration = source(
    "supabase/migrations/20260926160847_dev_04c_integrations_entitlement.sql",
  );
  const capabilities = source("lib/auth/capabilities.ts");
  const page = source("app/admin/integraciones/asistian/page.tsx");
  const actions = source("app/admin/integraciones/asistian/actions.ts");
  const config = source("app/admin/configuracion/page.tsx");
  const more = source("app/admin/mas/page.tsx");

  it("maps integration capabilities into the integrations SaaS module", () => {
    expect(capabilities).toContain('INTEGRATIONS_READ: "integrations.read"');
    expect(capabilities).toContain('INTEGRATIONS_MANAGE: "integrations.manage"');
    expect(migration).toContain("('integrations.read','integrations')");
    expect(migration).toContain("('integrations.manage','integrations')");
  });

  it("gates admin UI and writes through effective capabilities", () => {
    expect(page).toContain("CAPABILITIES.INTEGRATIONS_READ");
    expect(actions).toContain("CAPABILITIES.INTEGRATIONS_MANAGE");
    expect(config).toContain("CAPABILITIES.INTEGRATIONS_READ");
    expect(more).toContain("CAPABILITIES.INTEGRATIONS_READ");
  });

  it("gates Asistian runtime and Data API reads when the module is disabled", () => {
    expect(migration).toContain("private.studio_has_module(target_studio_id, 'integrations')");
    expect(migration).toContain("reason_code', 'module_disabled'");
    expect(migration).toContain("private.has_capability(studio_id,'integrations.read')");
    expect(migration).toContain("private.has_capability(target_studio_id, 'integrations.manage')");
  });
});
