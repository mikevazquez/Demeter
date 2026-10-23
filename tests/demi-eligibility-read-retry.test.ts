import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readBookingEligibility } from "../lib/assistant/action-tools";

describe("F04: one bounded retry of eligibility reads", () => {
  it.each([true, false])(
    "recovers SQLSTATE57014 with identical scope (service=%s)",
    async (serviceMode) => {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { code: "57014" } })
        .mockResolvedValueOnce({ data: { eligible: true }, error: null });
      const result = await readBookingEligibility(
        { supabase: { rpc } as never, studio: { id: "studio" } as never, serviceMode },
        "session",
        "student",
      );
      expect(result.data).toEqual({ eligible: true });
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
      expect(rpc.mock.calls[0][0]).toBe(
        serviceMode ? "service_booking_eligibility" : "booking_eligibility",
      );
      expect(rpc.mock.calls[0][1]).toMatchObject({
        target_session_id: "session",
        target_student_id: "student",
      });
      if (serviceMode) expect(rpc.mock.calls[0][1]).toHaveProperty("target_studio_id", "studio");
    },
  );

  it("does not retry indefinitely when the second read also times out", async () => {
    const response = { data: null, error: { code: "57014" } };
    const rpc = vi.fn().mockResolvedValue(response);
    expect(
      await readBookingEligibility(
        { supabase: { rpc } as never, studio: { id: "studio" } as never, serviceMode: true },
        "session",
        "student",
      ),
    ).toBe(response);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    { data: { eligible: false, reason_code: "payment_pending" }, error: null },
    { data: { eligible: false, reason_code: "session_full" }, error: null },
    { data: null, error: { code: "42501" } },
    { data: null, error: { code: "23505" } },
  ])("never retries a business denial or another error: %j", async (response) => {
    const rpc = vi.fn().mockResolvedValue(response);
    expect(
      await readBookingEligibility(
        { supabase: { rpc } as never, studio: { id: "studio" } as never, serviceMode: true },
        "session",
        "student",
      ),
    ).toBe(response);
    expect(rpc).toHaveBeenCalledOnce();
  });
});
