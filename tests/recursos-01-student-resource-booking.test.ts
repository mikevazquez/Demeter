import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RECURSOS-01 student resource selection", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922063440_recursos01_student_resource_booking.sql",
    ),
    "utf8",
  );
  const resourcePage = readFileSync(
    join(process.cwd(), "app/student/reservar/[sessionId]/recurso/page.tsx"),
    "utf8",
  );
  const picker = readFileSync(
    join(process.cwd(), "app/student/reservar/[sessionId]/recurso/ResourcePicker.tsx"),
    "utf8",
  );
  const detailPage = readFileSync(
    join(process.cwd(), "app/student/reservar/[sessionId]/page.tsx"),
    "utf8",
  );
  const confirmPage = readFileSync(
    join(process.cwd(), "app/student/reservar/[sessionId]/confirmar/page.tsx"),
    "utf8",
  );
  const actions = readFileSync(join(process.cwd(), "app/student/actions.ts"), "utf8");
  const quickBook = readFileSync(
    join(process.cwd(), "app/student/reservar/quick-book-button.tsx"),
    "utf8",
  );
  const successPage = readFileSync(
    join(process.cwd(), "app/student/reservar/confirmacion/page.tsx"),
    "utf8",
  );

  it("locks one session resource before booking to prevent last-slot races", () => {
    expect(migration).toContain("student_book_session_with_resource");
    expect(migration).toContain("from public.session_resources sr");
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_used >= v_capacity");
    expect(migration).toContain("'resource_full'");
  });

  it("books the class and resource in the same database transaction", () => {
    expect(migration).toContain("v_booking := public.book_student");
    expect(migration).toContain("insert into public.reservation_resource_assignments");
    expect(migration).toContain("v_reservation_id");
    expect(actions).toContain('rpc("student_book_session_with_resource"');
    expect(actions).toContain("target_resource_id: resourceId");
  });

  it("returns only aggregate resource occupancy to students", () => {
    expect(migration).toContain("student_session_resource_map");
    expect(migration).toContain("'used'");
    expect(migration).toContain("'available'");
    expect(migration).toContain("space_map_elements");

    const resourceMapFunction = migration.slice(
      migration.indexOf("create or replace function public.student_session_resource_map"),
      migration.indexOf("create or replace function public.student_book_session_with_resource"),
    );
    expect(resourceMapFunction).not.toMatch(/full_name|first_name|last_name/);
  });

  it("routes resource-based classes through the visual picker", () => {
    expect(detailPage).toContain("session.requires_resource");
    expect(detailPage).toContain("/recurso?date=");
    expect(resourcePage).toContain('rpc("student_session_resource_map"');
    expect(picker).toContain("Elige tu recurso");
    expect(picker).toContain("resourceMap");
  });

  it("shows available, full and unavailable states on the canonical map", () => {
    expect(picker).toContain("resource.available > 0");
    expect(picker).toContain("Disponible");
    expect(picker).toContain("Compartido");
    expect(picker).toContain("Completo");
    expect(picker).toContain("No disponible");
    expect(picker).toContain("element.rotation_degrees");
  });

  it("does not let quick booking bypass the detail and resource-selection flow", () => {
    expect(quickBook).toContain("requiresResource");
    expect(quickBook).toContain("router.push(`/student/reservar/${sessionId}`)");
    expect(detailPage).toContain("/recurso?date=");
  });

  it("revalidates the selected resource on confirmation and on final booking", () => {
    expect(confirmPage).toMatch(/rpc\(\s*"student_session_resource_map"/);
    expect(confirmPage).toContain('name="resource_id"');
    expect(confirmPage).toContain("selectedResource.available <= 0");
    expect(actions).toContain("resource_full");
    expect(actions).toContain("/recurso?error=");
  });

  it("shows the assigned resource after a successful reservation", () => {
    expect(successPage).toContain('from("reservation_resource_assignments")');
    expect(successPage).toContain("assignedResourceName");
    expect(successPage).toContain("Recurso:");
  });
});
