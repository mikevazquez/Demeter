import { describe, expect, it } from "vitest";
import { contactStage, renewalRecommended, channelLabel } from "../lib/student-crm";

describe("CRM contact stages and renewal signals", () => {
  it.each([
    [{ lifecycle_status: "active" }, "student"],
    [{ lifecycle_status: "inactive", student_type: "trial" }, "former"],
    [{ lifecycle_status: "active", student_type: "trial", trial_status: "no_show" }, "trial"],
    [{ lifecycle_status: "active", student_type: "trial", trial_status: "converted" }, "student"],
  ])("classifies the recorded lifecycle %j", (record, stage) => {
    expect(contactStage(record)).toBe(stage);
  });
  it.each([
    ["2026-10-08", false],
    ["2026-10-09", true],
    ["2026-10-16", true],
    ["2026-10-17", false],
    [null, false],
  ])("limits the renewal signal to the next seven days: %s", (expires, expected) => {
    expect(renewalRecommended("student", expires, "2026-10-09", "2026-10-16")).toBe(expected);
  });
  it.each(["former", "trial", "prospect"] as const)(
    "does not recommend a student renewal for %s",
    (stage) => {
      expect(renewalRecommended(stage, "2026-10-12", "2026-10-09", "2026-10-16")).toBe(false);
    },
  );
  it("does not infer WhatsApp from a phone number", () => {
    expect(channelLabel(undefined)).toBe("Sin conversación");
    expect(channelLabel("instagram")).toBe("Instagram");
    expect(channelLabel("unknown")).toBe("Otro canal");
  });
});
