import { describe, expect, it, vi } from "vitest";
import { resolveEnrollmentStatus } from "../lib/assistant/enrollment-state";
vi.mock("server-only", () => ({}));
import { getStudentPackageStatus } from "../lib/assistant/read-tools";
import {
  isExplicitAssistantConfirmation,
  isExplicitCashPurchaseConfirmation,
} from "../lib/assistant/action-tools";

describe("Demi 2.0 enrollment and natural confirmation", () => {
  it("accepts cash purchase details only when they match the prepared summary", () => {
    const summary = { amount_minor: 60000, product_name: "Paquete UAT 8 clases" };
    expect(
      isExplicitCashPurchaseConfirmation(
        "Sí, confirmo la compra del paquete de 8 clases por $600 en efectivo.",
        summary,
      ),
    ).toBe(true);
    for (const reply of [
      "Sí, confirmo la compra del paquete de 4 clases por $600 en efectivo.",
      "Sí, confirmo la compra del paquete de 8 clases por $500 en efectivo.",
      "No confirmo la compra del paquete de 8 clases por $600 en efectivo.",
      "Si hay lugar, confirmo la compra del paquete de 8 clases por $600 en efectivo.",
      "¿Confirmo la compra del paquete de 8 clases por $600 en efectivo?",
    ])
      expect(isExplicitCashPurchaseConfirmation(reply, summary)).toBe(false);
  });

  it.each([
    [[], "missing"],
    [[{ status: "active", starts_on: "2026-10-01", expires_on: "2026-10-09" }], "active"],
    [[{ status: "active", starts_on: "2026-10-01", expires_on: "2026-10-08" }], "expired"],
    [[{ status: "cancelled", starts_on: "2026-10-01", expires_on: null }], "missing"],
    [[{ status: "active", starts_on: "2026-10-10", expires_on: null }], "missing"],
    [
      [
        { status: "expired", starts_on: "2025-01-01", expires_on: "2025-02-01" },
        { status: "active", starts_on: "2026-01-01", expires_on: null },
      ],
      "active",
    ],
  ])("resolves enrollment independently of a package", (rows, expected) => {
    expect(resolveEnrollmentStatus(rows, "2026-10-09")).toBe(expected);
  });

  it.each([
    "Sí, confirmo la reserva",
    "Confirmo la reserva",
    "Sí, confirmo",
    "Sí, resérvame esa clase",
  ])("accepts one explicit confirmation: %s", (reply) => {
    expect(isExplicitAssistantConfirmation(reply)).toBe(true);
  });
  it.each(["No confirmo la reserva", "¿Confirmo la reserva?", "Si hay lugar, confirmo la reserva"])(
    "does not authorize ambiguous or negative replies: %s",
    (reply) => {
      expect(isExplicitAssistantConfirmation(reply)).toBe(false);
    },
  );

  it.each([
    ["active", "2020-01-01", "student"],
    ["expired", null, "former_student"],
  ])(
    "reads enrollment without deriving identity from package: %s",
    async (status, packageExpiry, expected) => {
      const scopes: string[] = [];
      const fake = {
        from(table: string) {
          const data =
            table === "students"
              ? { lifecycle_status: "active", student_type: "regular", trial_status: null }
              : table === "student_enrollments"
                ? [
                    {
                      status,
                      starts_on: "2020-01-01",
                      expires_on: status === "active" ? null : "2020-01-02",
                    },
                  ]
                : [{ status: "expired", expires_on: packageExpiry, access_blocked: false }];
          const chain: Record<string, unknown> = {
            select: () => chain,
            is: () => chain,
            order: () => chain,
            limit: () => chain,
            eq: (key: string, value: string) => {
              scopes.push(`${table}:${key}:${value}`);
              return chain;
            },
            maybeSingle: async () => ({ data, error: null }),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data, error: null }).then(resolve),
          };
          return chain;
        },
      };
      const result = await getStudentPackageStatus({
        supabase: fake as never,
        studio: { id: "studio", name: "UAT", timezone: "America/Mexico_City", currency: "MXN" },
        studentId: "student",
      });
      expect(result.ok).toBe(true);
      expect(result.student_state?.category).toBe(expected);
      expect(result.student_state?.enrollment_status).toBe(status);
      expect(scopes).toContain("student_enrollments:studio_id:studio");
      expect(scopes).toContain("student_enrollments:student_id:student");
    },
  );
});
