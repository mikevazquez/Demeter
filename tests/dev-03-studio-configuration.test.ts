import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-03 studio configuration", () => {
  const migration = source(
    "supabase/migrations/20260926013158_dev_03_studio_configuration.sql",
  );
  const configPage = source("app/admin/configuracion/page.tsx");
  const configActions = source("app/admin/configuracion/actions.ts");
  const portalLanding = source("app/components/studio-portal-landing.tsx");
  const publicPortal = source("lib/studio-public-portal.ts");
  const identityForm = source("app/admin/configuracion/PortalIdentityForm.tsx");

  it("stores operating policy per studio with Demeter-compatible defaults", () => {
    expect(migration).toContain("create table if not exists public.studio_operating_policies");
    expect(migration).toContain("cancellation_cutoff_minutes integer not null default 300");
    expect(migration).toContain("late_cancellation_consumes_credit boolean not null default true");
    expect(migration).toContain("no_show_consumes_credit boolean not null default true");
  });

  it("makes cancellation classification tenant-aware", () => {
    expect(migration).toContain(
      "private.reservation_cancellation_outcome(target_studio_id uuid, target_starts_at timestamp with time zone)",
    );
    expect(migration).toContain(
      "private.reservation_cancellation_outcome(v_reservation.studio_id, v_session.starts_at)",
    );
    expect(migration).not.toContain(
      "private.reservation_cancellation_outcome(target_starts_at timestamp with time zone)",
    );
  });

  it("uses studio policy for late cancellation and no-show credit consumption", () => {
    expect(migration).toContain("private.reservation_credit_should_consume");
    expect(migration).toContain("v_policy.no_show_consumes_credit");
    expect(migration).toContain("v_policy.late_cancellation_consumes_credit");
    expect(migration).toContain(
      "private.reservation_credit_should_consume(v_reservation.studio_id, v_reservation.status)",
    );
  });

  it("keeps Asistian aligned with the same tenant policy", () => {
    expect(migration).toContain(
      "private.reservation_cancellation_outcome(target_studio_id, v_old_session.starts_at)",
    );
    expect(migration).toContain(
      "private.reservation_credit_should_consume(target_studio_id, v_new_status)",
    );
  });

  it("moves the public tagline out of Demeter-specific frontend code", () => {
    expect(migration).toContain("add column if not exists tagline text");
    expect(migration).toContain("Movimiento que transforma");
    expect(publicPortal).toContain("tagline: string | null");
    expect(portalLanding).toContain("portal.tagline");
    expect(portalLanding).not.toContain("Movimiento que transforma");
    expect(identityForm).not.toContain("<p>Movimiento que transforma</p>");
  });

  it("exposes owner-managed identity, operating policy, and regional settings", () => {
    expect(configPage).toContain("OperatingPolicyForm");
    expect(configPage).toContain("RegionalSettingsForm");
    expect(configActions).toContain("owner_update_studio_operating_policy");
    expect(configActions).toContain("owner_update_studio_regional_settings");
    expect(configActions).toContain("owner_update_studio_portal_branding");
  });

  it("keeps minimum reservation rules activity-specific while allowing tenant defaults", () => {
    expect(migration).not.toContain("minimum_reservations integer");
    expect(configPage).toContain("default_minimum_reservations");
    expect(configPage).toContain("OperatingPolicyForm");
  });
});
