import { describe, expect, it } from "vitest";
import {
  applyJourneyEvent as apply,
  newProspect,
  isOutreachPaused,
  nextAction,
  type JourneyEvent,
  type CrmState,
} from "../lib/crm/demi-state";
let serial = 0;
function event(input: Omit<JourneyEvent, "id" | "at">): JourneyEvent {
  return { ...input, id: `evt-${++serial}`, at: "2026-10-08T12:00:00Z" } as JourneyEvent;
}
function booked(): CrmState {
  return apply(
    newProspect(),
    event({
      kind: "reservation_created",
      reservationId: "r1",
      receiptReceived: true,
      participantsComplete: true,
      capacityVerified: true,
    } as Omit<JourneyEvent, "id" | "at">),
  );
}
function enrolled(): CrmState {
  return apply(
    booked(),
    event({ kind: "enrollment_activated", enrollmentId: "e1", paymentVerified: true } as Omit<
      JourneyEvent,
      "id" | "at"
    >),
  );
}
describe("CRM aligned with Demi configuration", () => {
  it("keeps incomplete participant data in its own prospect stage", () => {
    const s = apply(newProspect(), event({ kind: "receipt_received" }));
    expect(s.personType).toBe("prospect");
    expect(s.stage).toBe("awaiting_participant_data");
    expect(() => apply(s, event({ kind: "followups_exhausted" }))).toThrow();
  });
  it("does not classify failed bookings as Trial", () => {
    for (const missing of ["receiptReceived", "participantsComplete", "capacityVerified"]) {
      const input = {
        kind: "reservation_created",
        reservationId: "r1",
        receiptReceived: true,
        participantsComplete: true,
        capacityVerified: true,
        [missing]: false,
      };
      expect(() => apply(newProspect(), event(input as Omit<JourneyEvent, "id" | "at">))).toThrow();
    }
  });
  it.each([true, false])("attendance %s preserves Trial", (attended) => {
    const s = apply(
      booked(),
      event({ kind: "attendance_recorded", reservationId: "r1", attended } as Omit<
        JourneyEvent,
        "id" | "at"
      >),
    );
    expect(s.personType).toBe("trial");
    expect(s.stage).toBe(attended ? "attended" : "not_attended");
  });
  it("preserves Trial when payment is rejected and replaced", () => {
    const rejected = apply(booked(), event({ kind: "payment_rejected" }));
    expect(rejected.stage).toBe("payment_rejected");
    expect(apply(rejected, event({ kind: "receipt_received" })).personType).toBe("trial");
  });
  it("requires verified enrollment payment", () => {
    expect(() =>
      apply(
        booked(),
        event({ kind: "enrollment_activated", enrollmentId: "e1", paymentVerified: false } as Omit<
          JourneyEvent,
          "id" | "at"
        >),
      ),
    ).toThrow();
    expect(enrolled().personType).toBe("student");
  });
  it("package expiry never makes an Alumna an Exalumna", () => {
    const s = apply(
      enrolled(),
      event({ kind: "package_changed", status: "expired" } as Omit<JourneyEvent, "id" | "at">),
    );
    expect(s.personType).toBe("student");
    expect(nextAction(s)).toBe("Renovar paquete");
  });
  it("enrollment expiry preserves an active package and renewal restores Alumna", () => {
    const active = apply(
      enrolled(),
      event({ kind: "package_changed", status: "active" } as Omit<JourneyEvent, "id" | "at">),
    );
    const expired = apply(
      active,
      event({ kind: "enrollment_expired", enrollmentId: "e1", expiryVerified: true } as Omit<
        JourneyEvent,
        "id" | "at"
      >),
    );
    expect(expired.personType).toBe("former_student");
    expect(expired.package).toBe("active");
    expect(
      apply(
        expired,
        event({ kind: "enrollment_activated", enrollmentId: "e2", paymentVerified: true } as Omit<
          JourneyEvent,
          "id" | "at"
        >),
      ).personType,
    ).toBe("student");
  });
  it("requires a reason for No clasifica and reopens on inbound", () => {
    expect(() =>
      apply(
        newProspect(),
        event({ kind: "qualification_changed", value: "not_qualified" } as Omit<
          JourneyEvent,
          "id" | "at"
        >),
      ),
    ).toThrow();
    const closed = apply(
      newProspect(),
      event({ kind: "qualification_changed", value: "not_qualified", reason: "Distancia" } as Omit<
        JourneyEvent,
        "id" | "at"
      >),
    );
    expect(isOutreachPaused(closed)).toBe(true);
    const reopened = apply(closed, event({ kind: "inbound_received" }));
    expect(reopened.qualification).toBe("pending");
    expect(isOutreachPaused(reopened)).toBe(false);
    expect(reopened.history[0].event).toHaveProperty("reason", "Distancia");
  });
  it("No agendó is a Prospecto and reopens without duplication", () => {
    const s = apply(newProspect(), event({ kind: "followups_exhausted" }));
    expect(s.personType).toBe("prospect");
    expect(isOutreachPaused(s)).toBe(true);
    expect(apply(s, event({ kind: "inbound_received" })).stage).toBe("answering_questions");
  });
  it("human attention is transversal and preserves type, stage, payment and package", () => {
    for (const state of [newProspect(), booked(), enrolled()]) {
      const s = apply(
        state,
        event({
          kind: "human_requested",
          reason: "requested",
          summary: "Solicita hablar con el equipo",
        } as Omit<JourneyEvent, "id" | "at">),
      );
      expect([s.personType, s.stage, s.payment, s.package]).toEqual([
        state.personType,
        state.stage,
        state.payment,
        state.package,
      ]);
      expect(isOutreachPaused(s)).toBe(true);
      expect(apply(s, event({ kind: "human_resolved" })).human).toBeNull();
    }
  });
  it("is idempotent and never rewrites earlier history", () => {
    const e = event({ kind: "payment_requested" });
    const base = newProspect();
    const once = apply(base, e);
    expect(apply(once, e)).toBe(once);
    expect(base.history).toEqual([]);
    expect(once.history).toHaveLength(1);
  });
});
