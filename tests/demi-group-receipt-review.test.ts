import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/assistant/group-receipt-review.ts", "utf8").replace(
  'import "server-only";',
  "",
);
const loaded = { exports: {} as typeof import("../lib/assistant/group-receipt-review") };
new Function("module", "exports", transformSync(source, { loader: "ts", format: "cjs" }).code)(
  loaded,
  loaded.exports,
);
function client(rows: Record<string, unknown[]>, failedTable?: string) {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        then(resolve: (result: unknown) => unknown) {
          return Promise.resolve({
            data: rows[table] ?? [],
            error: table === failedTable ? { message: "unavailable" } : null,
          }).then(resolve);
        },
      };
      return query;
    },
  } as never;
}
const rows = {
  demi_group_participants: [{ group_id: "group", transfer_intent_id: "intent" }],
  demi_group_bookings: [{ id: "group", amount_minor: 30000, currency: "MXN" }],
  demi_group_receipts: [
    {
      id: "first",
      group_id: "group",
      storage_path: "studio/first",
      amount_minor: 15000,
      status: "received",
    },
    {
      id: "second",
      group_id: "group",
      storage_path: "studio/second",
      amount_minor: 15000,
      status: "received",
    },
  ],
};
describe("manual group payment evidence", () => {
  it("returns both partial documents and the group total for one participant purchase", async () => {
    const result = await loaded.exports.getTransferGroupReceiptReviews(client(rows), "studio", [
      "intent",
    ]);
    expect(result.available).toBe(true);
    expect(result.byIntent.get("intent")).toMatchObject({
      amountMinor: 30000,
      documents: [
        { id: "first", amountMinor: 15000 },
        { id: "second", amountMinor: 15000 },
      ],
    });
  });
  it("retains unreadable evidence for review alongside readable documents", async () => {
    const result = await loaded.exports.getTransferGroupReceiptReviews(
      client({
        ...rows,
        demi_group_receipts: [
          ...rows.demi_group_receipts,
          {
            id: "bad",
            group_id: "group",
            storage_path: "studio/bad",
            amount_minor: null,
            status: "unreadable",
          },
        ],
      }),
      "studio",
      ["intent"],
    );
    expect(result.byIntent.get("intent")?.documents).toHaveLength(3);
    expect(result.byIntent.get("intent")?.documents[2]).toMatchObject({
      status: "unreadable",
      amountMinor: null,
    });
  });
  it("cannot expose documents when the referenced group is outside the visible studio", async () => {
    const result = await loaded.exports.getTransferGroupReceiptReviews(
      client({ ...rows, demi_group_bookings: [] }),
      "studio",
      ["intent"],
    );
    expect(result.available).toBe(false);
    expect(result.byIntent.size).toBe(0);
  });
  it("does not silently fall back to one document after an evidence lookup failure", async () => {
    const result = await loaded.exports.getTransferGroupReceiptReviews(
      client(rows, "demi_group_receipts"),
      "studio",
      ["intent"],
    );
    expect(result.available).toBe(false);
    expect(result.byIntent.size).toBe(0);
  });
});
