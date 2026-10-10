import { describe, expect, it } from "vitest";
import {
  conversationGuidance,
  needsFirstVisitGuidance,
} from "../lib/assistant/conversation-guidance";

describe("Demi first visit audience", () => {
  it("continues helping a prospect after Studio Flow creates a trial student record", () => {
    expect(needsFirstVisitGuidance({ crmContactId: "contact" })).toBe(true);
    for (const studentCategory of ["trial_pending", "trial_cancelled", "trial_no_show"]) {
      expect(needsFirstVisitGuidance({ studentId: "student", studentCategory })).toBe(true);
    }
  });

  it("does not apply first visit sales to attended trials, existing students or former students", () => {
    for (const studentCategory of ["trial_attended", "student", "former_student", null]) {
      expect(
        needsFirstVisitGuidance({ studentId: "student", crmContactId: "contact", studentCategory }),
      ).toBe(false);
    }
    expect(needsFirstVisitGuidance({})).toBe(false);
  });

  it("tests the selected persona even if a real identity is supplied to the simulator", () => {
    expect(
      needsFirstVisitGuidance({ studentId: "student", testSimulation: { persona: "prospect" } }),
    ).toBe(true);
    expect(
      needsFirstVisitGuidance({ crmContactId: "contact", testSimulation: { persona: "student" } }),
    ).toBe(false);
  });

  it("covers trial lifecycle fixtures in the workbench without applying sales to attended or former students", () => {
    for (const persona of ["trial_pending_reserved", "trial_cancelled", "trial_no_show"] as const) {
      expect(needsFirstVisitGuidance({ testSimulation: { persona } })).toBe(true);
    }
    for (const persona of [
      "trial_attended",
      "student",
      "student_reserved",
      "former_student",
    ] as const) {
      expect(needsFirstVisitGuidance({ testSimulation: { persona } })).toBe(false);
    }
    expect(conversationGuidance({ testSimulation: { persona: "unresolved_identity" } })).toContain(
      "no menciones simulaciones, perfiles de prueba",
    );
  });

  it("moves an explicit first booking request to real class options before collecting the name", () => {
    const guidance = conversationGuidance({ crmContactId: "contact" });
    expect(guidance).toContain("no respondas pidiendo únicamente su nombre");
    expect(guidance).toContain("search_class_availability en ese mismo turno");
    expect(guidance).toContain(
      "No pidas nombre ni datos completos de acompañantes antes de recibir el comprobante",
    );
    expect(guidance).toContain("Nunca conviertas 'gracias'");
    expect(guidance).toContain("en una orden de reserva");
  });
});
