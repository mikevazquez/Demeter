import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getCommercialOptions } from "@/lib/assistant/read-tools";

function context(studentId?: string, cashActive = true, methodError = false) {
  const calls: Array<[string, string, unknown]> = [];
  const products = [
    {
      id: "package",
      name: "Paquete 8 clases",
      product_type: "package",
      online_purchasable: true,
      enrollment_included: false,
    },
  ];
  const methods = [
    { code: "cash", name: "Efectivo", category: "cash", active: cashActive },
    { code: "bank_transfer", name: "Transferencia", category: "transfer", active: true },
  ];
  return {
    calls,
    value: {
      studentId,
      studio: { id: "studio", name: "UAT", timezone: "America/Mexico_City", currency: "MXN" },
      supabase: {
        rpc: vi.fn().mockResolvedValue({ data: { eligible: true }, error: null }),
        from(table: string) {
          let rows = table === "product_templates" ? products : methods;
          const builder = {
            select() {
              return this;
            },
            eq(column: string, value: unknown) {
              calls.push([table, column, value]);
              if (table === "studio_payment_methods" && column === "active") {
                rows = methods.filter((row) => row.active === value);
              }
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            then(resolve: (result: unknown) => unknown) {
              return Promise.resolve({
                data: rows,
                error: table === "studio_payment_methods" && methodError ? {} : null,
              }).then(resolve);
            },
          };
          return builder;
        },
      } as never,
    },
  };
}

describe("commercial cash availability regression", () => {
  it.each([undefined, "student"])(
    "reports active cash for audience %s without promising a prospect reservation",
    async (studentId) => {
      const ctx = context(studentId);
      const result = await getCommercialOptions(ctx.value, { session_ref: null });
      expect(result).toMatchObject({ ok: true });
      expect("payment_options" in result && result.payment_options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "cash",
            channel: "studio",
            student_package: {
              requires_verified_regular_student: true,
              requires_confirmation: true,
              provisional_activation: true,
              debt_persists_if_absent: true,
              first_reservation_allowed: true,
              second_reservation_requires_payment: true,
            },
            prospect: {
              reservation_allowed: false,
              walk_in_subject_to_availability: true,
              minimum_payment_objections: 2,
            },
          }),
          expect.objectContaining({ code: "bank_transfer" }),
          expect.objectContaining({ code: "app_mercado_pago" }),
        ]),
      );
      expect(ctx.calls).toContainEqual(["studio_payment_methods", "studio_id", "studio"]);
      expect(ctx.calls).toContainEqual(["studio_payment_methods", "active", true]);
    },
  );

  it("does not advertise cash when the configured method is disabled", async () => {
    const result = await getCommercialOptions(context("student", false).value, {
      session_ref: null,
    });
    expect("payment_options" in result && result.payment_options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "cash" })]),
    );
  });

  it("does not infer payment availability after a failed configuration read", async () => {
    const result = await getCommercialOptions(context("student", true, true).value, {
      session_ref: null,
    });
    expect(result).toEqual({ ok: false, error: "commercial_payment_methods_unavailable" });
  });
});
