import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("RECURSOS-01 coach canonical resource map", () => {
  const migration = source("supabase/migrations/20260922184500_recursos01_coach_resource_map.sql");
  const coachPage = source("app/coach/clases/[sessionId]/page.tsx");

  it("scopes the map to the authenticated instructor assignment", () => {
    expect(migration).toContain("private.current_instructor_id(target_studio_id)");
    expect(migration).toContain("cs.instructor_id = v_instructor_id");
    expect(migration).toContain("raise exception 'session_not_available'");
  });

  it("reads the same canonical geometry tables used by admin and students", () => {
    expect(migration).toContain("from public.space_maps sm");
    expect(migration).toContain("from public.space_map_elements e");
    expect(migration).toContain("from public.session_resources sr");
    expect(migration).toContain("from public.reservation_resource_assignments a");
  });

  it("renders the canonical map as read-only in the coach portal", () => {
    expect(coachPage).toContain('rpc("coach_session_resource_map"');
    expect(coachPage).toContain("resourceMap.elements.map");
    expect(coachPage).toContain("element.rotation_degrees");
    expect(coachPage).toContain("Vista de solo lectura");
    expect(coachPage).not.toContain("admin_save_session_resources");
  });
});
