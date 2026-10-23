import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolvedPendingInstructions } from "../lib/assistant/conversation-context";

describe("DEMI-BASE-03 resolved pendings", () => {
  it("adds nothing when no pending was closed", () => {
    expect(resolvedPendingInstructions([])).toBe("");
  });

  it("tells Demi a closed first-class payment no longer exists", () => {
    const text = resolvedPendingInstructions([{ kind: "first_class", reason: "package_acquired" }]);
    expect(text).toContain("PENDIENTES CERRADOS");
    expect(text).toContain("pago de primera clase");
    expect(text).toContain("no lo menciones");
    expect(text).toContain("no reenvíes datos bancarios");
  });

  it("names a closed package purchase and deduplicates labels", () => {
    const text = resolvedPendingInstructions([
      { kind: "product_purchase", reason: "package_acquired" },
      { kind: "trial_class", reason: "package_acquired" },
      { kind: "first_class", reason: "reservation_exists" },
    ]);
    expect(text).toContain("compra de paquete por transferencia y pago de primera clase");
    expect(text.match(/pago de primera clase/g)).toHaveLength(1);
  });
});

describe("DEMI-BASE-03 supersede migration guards", () => {
  const sql = readFileSync(
    "supabase/migrations/20261021190000_demi_supersede_resolved_pendings.sql",
    "utf8",
  );

  it("only closes pendings that never received a receipt", () => {
    expect(sql).toContain("g.status = 'awaiting_receipt'");
    expect(sql).toContain("g.receipt_event_id is null");
    expect(sql).toContain("i.status = 'awaiting_receipt'");
    expect(sql).toContain("i.receipt_event_id is null");
  });

  it("never supersedes the transfer intent that is being activated", () => {
    expect(sql).toContain("i.id is distinct from v_origin");
  });

  it("leaves started online payments to their own flow", () => {
    expect(sql).toContain("r.status in ('order_created','pending','approved')");
  });

  it("keeps records instead of deleting them", () => {
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).toContain("superseded_reason");
  });
});
