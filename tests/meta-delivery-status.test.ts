import { describe, expect, it, vi } from "vitest";
import {
  extractMetaDeliveryStatuses,
  persistMetaDeliveryStatuses,
} from "../lib/assistant/meta-delivery-status";

const payload = (status: string, id = "wamid.example") => ({
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          value: {
            metadata: { phone_number_id: "phone-1" },
            statuses: [
              {
                id,
                status,
                timestamp: "1791400000",
                ...(status === "failed"
                  ? {
                      errors: [{ code: 131026, title: "Message undeliverable" }],
                    }
                  : {}),
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("Meta outbound delivery receipts", () => {
  it("extracts status callbacks without treating them as inbound messages", () => {
    expect(extractMetaDeliveryStatuses(payload("failed"))).toEqual([
      {
        messageId: "wamid.example",
        status: "failed",
        timestamp: "1791400000",
        errorCode: "131026",
        errorDescription: "Message undeliverable",
        phoneNumberId: "phone-1",
        wabaId: "waba-1",
      },
    ]);
    expect(extractMetaDeliveryStatuses({ entry: [] })).toEqual([]);
    expect(extractMetaDeliveryStatuses(payload("unknown"))).toEqual([]);
  });

  it("rejects receipts for another phone or WABA", async () => {
    const from = vi.fn();
    const result = await persistMetaDeliveryStatuses(
      { from } as never,
      "studio-1",
      extractMetaDeliveryStatuses(payload("delivered")),
      "other-phone",
      "waba-1",
    );
    expect(result).toEqual({ updated: 0, ignored: 1 });
    expect(from).not.toHaveBeenCalled();
  });

  it("persists delivered and failed states by provider message id, without sending messages", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const delivery = {
      id: "delivery-1",
      state: "accepted",
      delivered_at: null,
      message_snapshot: {},
    };
    const query = {
      select: vi.fn(),
      update: vi.fn((data: Record<string, unknown>) => {
        updates.push(data);
        return { eq: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }) };
      }),
    };
    query.select.mockReturnValue({
      eq: () => ({
        eq: () => ({ eq: () => ({ limit: async () => ({ data: [delivery], error: null }) }) }),
      }),
    });
    const assistant = {
      select: () => ({
        eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    };
    const client = {
      from: vi.fn((name: string) => (name === "notification_deliveries" ? query : assistant)),
    };
    const result = await persistMetaDeliveryStatuses(
      client as never,
      "studio-1",
      extractMetaDeliveryStatuses(payload("failed")),
      "phone-1",
      "waba-1",
    );
    expect(result.updated).toBe(1);
    expect(updates[0].state).toBe("failed_permanent");
    expect(updates[0].last_error_code).toBe("131026");
    expect(client.from).toHaveBeenCalledWith("notification_deliveries");
  });
});
