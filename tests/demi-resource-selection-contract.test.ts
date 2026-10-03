import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi resource selection flow", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const contracts = source("lib/assistant/tool-contracts.ts");
  const orchestrator = source("lib/assistant/orchestrator.ts");
  const migration = source(
    "supabase/migrations/20261003172600_demi_resource_booking_runtime.sql",
  );

  it("offers only currently available resources as numbered options", () => {
    expect(actions).toContain("getAvailableResourceOptions");
    expect(actions).toContain('status: "resource_selection_required"');
    expect(actions).toContain("option_number: index + 1");
    expect(actions).toContain("released_at");
    expect(actions).not.toContain(
      "El flujo de recursos todavía no está habilitado para Demi.",
    );
  });

  it("lets a later user turn choose one numbered resource", () => {
    expect(contracts).toContain('name: "select_resource_option"');
    expect(actions).toContain("async function selectResourceOption");
    expect(actions).toContain('stage: "confirmation"');
    expect(orchestrator).toContain(
      "Cuando la persona responda con el número de un recurso mostrado",
    );
  });

  it("books and reschedules with the selected resource atomically in service mode", () => {
    expect(actions).toContain("service_book_student_with_resource");
    expect(actions).toContain(
      "service_reschedule_student_reservation_with_resource",
    );
    expect(migration).toContain("reservation_resource_assignments");
    expect(migration).toContain(
      "revoke all on function public.service_book_student_with_resource",
    );
    expect(migration).toContain(
      "revoke all on function public.service_reschedule_student_reservation_with_resource",
    );
    expect(migration).toContain("to service_role;");
  });

  it("supports resource assignment for trial bookings in WhatsApp service mode", () => {
    expect(actions).toContain("service_confirm_trial_booking_with_resource");
    expect(migration).toContain(
      "public.assistant_confirm_trial_booking",
    );
  });

  it("does not escalate resource selection to a human", () => {
    expect(orchestrator).toContain(
      "NO escales a atención humana",
    );
  });
});
