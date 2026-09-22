import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RECURSOS-01 domain contract", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922055300_recursos01_domain_persistence.sql",
    ),
    "utf8",
  );
  const hardening = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922055433_recursos01_rls_policy_hardening.sql",
    ),
    "utf8",
  );

  it("keeps resource geometry global and session usage separate", () => {
    expect(migration).toContain("create table if not exists public.space_maps");
    expect(migration).toContain("create table if not exists public.space_map_elements");
    expect(migration).toContain("create table if not exists public.resources");
    expect(migration).toContain("create table if not exists public.session_resources");
    expect(migration).toContain(
      "create table if not exists public.reservation_resource_assignments",
    );
    expect(migration).toContain(
      "add column if not exists requires_resource boolean not null default false",
    );
    expect(migration).toContain(
      "add column if not exists resource_uses_per_item integer not null default 1",
    );
    expect(migration).not.toMatch(/capacity_override.*class_templates/i);
  });

  it("stores one reusable map position per physical resource", () => {
    expect(migration).toContain("space_map_elements_resource_unique");
    expect(migration).toContain("on public.space_map_elements(resource_id)");
    expect(migration).toContain("space_map_elements_resource_shape");
    expect(migration).toContain("x >= 0 and x <= 1");
    expect(migration).toContain("y >= 0 and y <= 1");
  });

  it("guards tenant, space and session integrity", () => {
    expect(migration).toContain("resource_space_studio_mismatch");
    expect(migration).toContain("resource_type_studio_mismatch");
    expect(migration).toContain("map_element_resource_mismatch");
    expect(migration).toContain("session_resource_space_mismatch");
    expect(migration).toContain("resource_assignment_reservation_mismatch");
    expect(migration).toContain("resource_not_configured_for_session");
  });

  it("enforces resource capacity under concurrency", () => {
    expect(migration).toContain("for update;");
    expect(migration).toContain("resource_full");
    expect(migration).toContain("reservation_resource_assignments_one_active_per_reservation");
    expect(migration).toContain("reservation_resource_assignments_active_resource_idx");
  });

  it("releases resource assignments when a reservation stops being active", () => {
    expect(migration).toContain("recursos01_release_assignment_after_reservation_status");
    expect(migration).toContain("released_at = coalesce(released_at, now())");
    expect(migration).toContain("'reservation_status:' || new.status::text");
  });

  it("prevents destructive resource changes while active assignments exist", () => {
    expect(migration).toContain("resource_has_active_assignments");
    expect(migration).toContain("session_resource_capacity_below_active_assignments");
    expect(migration).toContain("resource_has_future_assignments");
  });

  it("keeps SELECT policies separate from write policies", () => {
    expect(hardening).not.toMatch(/create policy .*_write[\s\S]*for all/i);
    expect(hardening).toContain("create policy resource_types_insert");
    expect(hardening).toContain("create policy resources_update");
    expect(hardening).toContain("create policy space_maps_delete");
    expect(hardening).toContain("create policy space_map_elements_insert");
    expect(hardening).toContain("create policy session_resources_update");
    expect(hardening).toContain("create policy resource_assignments_delete");
  });
});
