import { describe, expect, it } from "vitest";

import { packageRecoveryTiming } from "../supabase/functions/_shared/package-recovery-timing";

describe("package recovery notification timing", () => {
  it("schedules the first message at X local days after expiration", () => {
    const timing = packageRecoveryTiming({
      expiresOn: "2026-10-05",
      daysAfter: 7,
      timezone: "America/Mexico_City",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });

    expect(timing.scheduledFor).toBe("2026-10-12T16:00:00.000Z");
    expect(timing.suppressed).toBe(false);
  });

  it("supports the follow-up at 2X days across a daylight-saving transition", () => {
    const timing = packageRecoveryTiming({
      expiresOn: "2026-10-25",
      daysAfter: 14,
      timezone: "America/New_York",
      now: new Date("2026-10-26T12:00:00.000Z"),
    });

    expect(timing.scheduledFor).toBe("2026-11-08T15:00:00.000Z");
  });

  it("sends now when the target passed recently, then suppresses after the delivery window", () => {
    const sentNow = packageRecoveryTiming({
      expiresOn: "2026-10-01",
      daysAfter: 2,
      timezone: "America/Mexico_City",
      now: new Date("2026-10-04T16:00:00.000Z"),
    });
    const expired = packageRecoveryTiming({
      expiresOn: "2026-10-01",
      daysAfter: 2,
      timezone: "America/Mexico_City",
      now: new Date("2026-10-07T17:00:00.000Z"),
    });

    expect(sentNow.scheduledFor).toBe("2026-10-04T16:00:00.000Z");
    expect(sentNow.suppressed).toBe(false);
    expect(expired.suppressed).toBe(true);
    expect(expired.reasonCode).toBe("delivery_window_elapsed");
  });

  it("rejects missing expiry dates and out-of-range delays", () => {
    expect(() =>
      packageRecoveryTiming({
        expiresOn: null,
        daysAfter: 7,
        timezone: "America/Mexico_City",
      }),
    ).toThrow("after_event_config_invalid");
    expect(() =>
      packageRecoveryTiming({
        expiresOn: "2026-10-05",
        daysAfter: 0,
        timezone: "America/Mexico_City",
      }),
    ).toThrow("after_event_config_invalid");
  });
});
