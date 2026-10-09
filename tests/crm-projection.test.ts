import { describe, expect, it } from "vitest";
import { projectContact, type Validity } from "../lib/crm/projection";
const active: Validity = {
  id: "enrollment",
  status: "active",
  starts_on: "2026-01-01",
  expires_on: "2026-12-31",
  refunded_at: null,
};
const expired = { ...active, expires_on: "2026-10-08" };
const base = { today: "2026-10-09", enrollments: [] as Validity[], packages: [] as Validity[] };
describe("CRM projection from authoritative Studio Flow records", () => {
  it("keeps Student when package expires", () =>
    expect(projectContact({ ...base, enrollments: [active], packages: [expired] })).toMatchObject({
      personType: "student",
      package: "expired",
    }));
  it("keeps active package when enrollment expires", () =>
    expect(projectContact({ ...base, enrollments: [expired], packages: [active] })).toMatchObject({
      personType: "former_student",
      package: "active",
    }));
  it("prefers renewal over expired enrollment", () =>
    expect(projectContact({ ...base, enrollments: [expired, active] }).personType).toBe("student"));
  it("expiry day is still valid", () =>
    expect(
      projectContact({ ...base, enrollments: [{ ...active, expires_on: base.today }] }).personType,
    ).toBe("student"));
  it("does not treat refund as enrollment", () =>
    expect(
      projectContact({ ...base, enrollments: [{ ...active, refunded_at: "2026-10-09" }] })
        .personType,
    ).toBe("prospect"));
  it("does not promote mere trial student creation", () =>
    expect(
      projectContact({ ...base, studentType: "trial", trialStatus: "pending" }).personType,
    ).toBe("prospect"));
  it("attendance stays Trial", () =>
    expect(
      projectContact({ ...base, studentType: "trial", trialStatus: "attended" }).personType,
    ).toBe("trial"));
  it("requires a recorded reservation for scheduled Trial", () =>
    expect(
      projectContact({
        ...base,
        studentType: "trial",
        reservation: {
          id: "reservation",
          status: "confirmed",
          commercial_status: "payment_pending",
        },
      }),
    ).toMatchObject({ personType: "trial", stage: "scheduled" }));
  it("reflects recorded attendance even when cached trial status is pending", () =>
    expect(
      projectContact({
        ...base,
        studentType: "trial",
        trialStatus: "pending",
        reservation: { id: "r", status: "attended", commercial_status: "confirmed" },
      }),
    ).toMatchObject({ personType: "trial", stage: "attended" }));
  it("reflects no show from the recorded reservation", () =>
    expect(
      projectContact({
        ...base,
        studentType: "trial",
        trialStatus: "pending",
        reservation: { id: "r", status: "no_show", commercial_status: "confirmed" },
      }),
    ).toMatchObject({ personType: "trial", stage: "not_attended" }));
  it("preserves Trial after rejected payment", () =>
    expect(
      projectContact({
        ...base,
        studentType: "trial",
        trialStatus: "attended",
        paymentStatus: "rejected",
      }),
    ).toMatchObject({ personType: "trial", stage: "payment_rejected" }));
  it("keeps human attention separate from type", () =>
    expect(
      projectContact({
        ...base,
        enrollments: [active],
        followup: {
          prospect_stage: "answering_questions",
          qualification: "pending",
          qualification_reason: null,
          human_reason: "requested",
          human_summary: "Llamar",
        },
      }),
    ).toMatchObject({ personType: "student", human: { reason: "requested" } }));
});
