import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Studio public branding configuration", () => {
  const migration = source(
    "supabase/migrations/20260920133000_admin_ux_studio_portal_branding.sql",
  );
  const portalHelper = source("lib/studio-public-portal.ts");
  const landing = source("app/components/studio-portal-landing.tsx");
  const root = source("app/page.tsx");
  const tenant = source("app/s/[studioSlug]/page.tsx");
  const configPage = source("app/admin/configuracion/page.tsx");
  const configForm = source("app/admin/configuracion/PortalIdentityForm.tsx");
  const configActions = source("app/admin/configuracion/actions.ts");
  const adminLayout = source("app/admin/layout.tsx");

  it("stores a public logo path and exposes only public portal fields", () => {
    expect(migration).toContain("add column if not exists logo_path text");
    expect(migration).toContain("'studio-branding'");
    expect(migration).toContain("public.get_public_studio_portal");
    expect(migration).toContain("grant execute on function public.get_public_studio_portal");
    expect(portalHelper).toContain('from("studio-branding").getPublicUrl');
  });

  it("restricts portal identity changes to the Owner", () => {
    expect(migration).toContain("owner_update_studio_portal_branding");
    expect(migration).toContain("'owner'::public.studio_role");
    expect(configActions).toContain('ctx.membership.role !== "owner"');
    expect(configActions).toContain("CAPABILITIES.SETTINGS_WRITE");
    expect(configPage).toContain('ctx.membership.role !== "owner"');
  });

  it("validates and stores logos in the studio-owned folder", () => {
    expect(configActions).toContain("MAX_LOGO_BYTES");
    expect(configActions).toContain('"image/png"');
    expect(configActions).toContain('"image/jpeg"');
    expect(configActions).toContain('"image/webp"');
    expect(configActions).toContain("${ctx.studio.id}/logo-");
    expect(migration).toContain("studio_branding_insert_owner");
    expect(migration).toContain("studio_branding_delete_owner");
  });

  it("renders the configured name and logo on the public entry", () => {
    expect(landing).toContain("portal.name");
    expect(landing).toContain("portal.logoUrl");
    expect(landing).toContain("Movimiento que transforma");
    expect(landing).toContain("MI ESTUDIO");
    expect(landing).toContain("SOY ALUMNA");
    expect(root).toContain("getPublicStudioPortal()");
    expect(tenant).toContain("getPublicStudioPortal(studioSlug)");
  });

  it("gives the Owner a live preview and exposes Configuración only now that it exists", () => {
    expect(configForm).toContain("VISTA PREVIA");
    expect(configForm).toContain("Seleccionar logo");
    expect(configForm).toContain("Guardar identidad");
    expect(adminLayout).toContain('href: "/admin/configuracion"');
    expect(adminLayout).toContain('membership.role === "owner"');
  });

  it("removes Studio Flow from visible shell branding", () => {
    expect(adminLayout).not.toContain("<strong>Studio Flow</strong>");
    expect(adminLayout).toContain("<strong>{studio.name}</strong>");
  });
});
