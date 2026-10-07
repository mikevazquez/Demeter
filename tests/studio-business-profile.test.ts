import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Studio business profile", () => {
  const migration = source("supabase/migrations/20261007214000_studio_business_profile.sql");
  const more = source("app/admin/mas/page.tsx");
  const page = source("app/admin/configuracion/empresa/page.tsx");
  const actions = source("app/admin/configuracion/actions.ts");
  const reads = source("lib/assistant/read-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");

  it("provides an owner-only settings entry for public studio information", () => {
    expect(more).toContain('title: "Información del estudio"');
    expect(more).toContain('href: "/admin/configuracion/empresa"');
    expect(page).toContain("BusinessProfileForm");
    expect(actions).toContain("owner_update_studio_business_profile_v1");
  });

  it("stores public contact details and one primary location", () => {
    expect(migration).toContain("contact_phone");
    expect(migration).toContain("contact_email");
    expect(migration).toContain("website_url");
    expect(migration).toContain("is_primary boolean");
    expect(migration).toContain("studio_locations_one_primary_per_studio_idx");
  });

  it("makes Demi read the configured address and public contact details", () => {
    expect(contracts).toContain('name: "get_studio_information"');
    expect(contracts).toContain("teléfono, correo y página web");
    expect(reads).toContain("contact_phone,contact_email,website_url");
    expect(reads).toContain("primary_location");
    expect(reads).toContain("is_primary");
  });
});
