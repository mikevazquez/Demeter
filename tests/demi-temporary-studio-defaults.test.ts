import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getTemporaryInformation } from "@/lib/assistant/read-tools";

function context(details = "Domingos 9:00 a 10:30.", enabled = true, published = true) {
  const calls: Array<[string, string, unknown]> = [];
  const tables: Record<string, unknown> = {
    demi_temporary_information: [
      {
        id: "workshop-1",
        title: "Taller de aro",
        kind: "workshop",
        discipline: "Aro",
        details,
        promotion_starts_on: "2026-10-01",
        event_starts_on: "2026-11-01",
        event_ends_on: "2026-11-30",
        registration_deadline: null,
        status: published ? "published" : "archived",
      },
    ],
    studios: { contact_phone: "9990000000", contact_email: null, website_url: null },
    studio_locations: [{ name: "Principal", address: "Domicilio ficticio UAT", is_primary: true }],
    assistant_admin_rules: null,
    disciplines: [],
    studio_payment_methods: [
      { code: "cash", name: "Efectivo", category: "cash" },
      { code: "bank_transfer", name: "Transferencia", category: "transfer" },
    ],
    studio_bank_transfer_settings: {
      enabled,
      bank_name: "Banco UAT",
      account_holder: "Prueba UAT",
      account_number: "0000",
      instructions: "No realizar pagos reales.",
    },
  };
  return {
    calls,
    value: {
      studio: {
        id: "studio-1",
        name: "Estudio UAT",
        timezone: "America/Mexico_City",
        currency: "MXN",
        temporaryInformationNow: "2026-11-05T18:00:00.000Z",
      },
      supabase: {
        from(table: string) {
          const result = () => ({ data: tables[table], error: null });
          const builder = {
            select() {
              return this;
            },
            eq(column: string, value: unknown) {
              calls.push([table, column, value]);
              return this;
            },
            lte() {
              return this;
            },
            gte() {
              return this;
            },
            or() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve(result());
            },
            maybeSingle() {
              return Promise.resolve(result());
            },
            then(resolve: (value: ReturnType<typeof result>) => unknown) {
              return Promise.resolve(result()).then(resolve);
            },
          };
          return builder;
        },
      } as never,
    },
  };
}

describe("Temporary information inherits studio defaults", () => {
  it("returns the studio location, active payment methods and transfer data without replacing workshop facts", async () => {
    const ctx = context();
    const result = await getTemporaryInformation(ctx.value, { topic: "taller de aro" });
    expect(result).toMatchObject({
      items: [{ details: "Domingos 9:00 a 10:30." }],
      studio_defaults: {
        information: { primary_location: { address: "Domicilio ficticio UAT" } },
        payment: {
          ok: true,
          methods: [{ code: "cash" }, { code: "bank_transfer" }],
          bank_transfer: { account_number: "0000" },
        },
      },
    });
    expect(ctx.calls).toContainEqual(["studio_payment_methods", "studio_id", "studio-1"]);
    expect(ctx.calls).toContainEqual(["studio_payment_methods", "active", true]);
    expect(ctx.calls).toContainEqual(["studio_bank_transfer_settings", "studio_id", "studio-1"]);
    expect(result.information_priority).toContain("Nunca sustituyas un precio ausente");
  });

  it("preserves explicit workshop exceptions separately from the studio fallback", async () => {
    const details =
      "Domingos 9:00. Sede especial: Recinto UAT. Sólo transferencia a cuenta UAT 1111.";
    const result = await getTemporaryInformation(context(details).value, { topic: "aro" });
    expect(result.items?.[0]?.details).toBe(details);
    expect(result.studio_defaults?.payment).toMatchObject({
      bank_transfer: { account_number: "0000" },
    });
    expect(result.information_priority).toContain("una sede distinta no cambia las formas de pago");
  });

  it("does not expose disabled transfer details", async () => {
    const result = await getTemporaryInformation(context(undefined, false).value, { topic: "aro" });
    expect(result.studio_defaults?.payment).toMatchObject({ bank_transfer: null });
  });

  it("does not attach studio fallback to an archived event", async () => {
    const ctx = context(undefined, true, false);
    const result = await getTemporaryInformation(ctx.value, { topic: "aro" });
    expect(result).toMatchObject({ items: [], studio_defaults: null });
    expect(ctx.calls.some(([table]) => table === "studio_payment_methods")).toBe(false);
  });
});
