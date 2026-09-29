import { describe, expect, it } from "vitest";

import { deriveStudentDirectoryRelationshipStatus } from "../lib/student/directory-status";

describe("student directory relationship status", () => {
  it("marks a student with a current product as active", () => {
    expect(
      deriveStudentDirectoryRelationshipStatus({
        lifecycleStatus: "active",
        studentType: "regular",
        trialStatus: null,
        hasCurrentProduct: true,
        hasExpiredProduct: true,
      }),
    ).toBe("active");
  });

  it("keeps a trial prospect in trial until conversion", () => {
    expect(
      deriveStudentDirectoryRelationshipStatus({
        lifecycleStatus: "active",
        studentType: "trial",
        trialStatus: "attended",
        hasCurrentProduct: false,
        hasExpiredProduct: false,
      }),
    ).toBe("trial");
  });

  it("marks a former paying student without a current product as expired", () => {
    expect(
      deriveStudentDirectoryRelationshipStatus({
        lifecycleStatus: "active",
        studentType: "regular",
        trialStatus: "converted",
        hasCurrentProduct: false,
        hasExpiredProduct: true,
      }),
    ).toBe("expired");
  });

  it("marks a person without trial or purchase history as prospect", () => {
    expect(
      deriveStudentDirectoryRelationshipStatus({
        lifecycleStatus: "active",
        studentType: "regular",
        trialStatus: null,
        hasCurrentProduct: false,
        hasExpiredProduct: false,
      }),
    ).toBe("prospect");
  });

  it("keeps an administratively inactive student inactive", () => {
    expect(
      deriveStudentDirectoryRelationshipStatus({
        lifecycleStatus: "inactive",
        studentType: "regular",
        trialStatus: null,
        hasCurrentProduct: true,
        hasExpiredProduct: true,
      }),
    ).toBe("inactive");
  });
});
