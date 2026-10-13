import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getStudioInformation } from "../lib/assistant/read-tools";

function context(rule: string | null, prompt: string, legacy = false) {
  const rows: Record<string, unknown> = {
    studios: {},
    studio_locations: [],
    disciplines: [{ name: "Exotic Pole" }],
    assistant_admin_rules: rule ? { instruction: rule } : null,
    assistant_configs: { personality_instructions: prompt },
  };
  return {
    studio: { id: "uat", name: "UAT", timezone: "America/Mexico_City", currency: "MXN" },
    supabase: {
      from(table: string) {
        let keyed = false;
        const q = {
          select: () => q,
          order: () => q,
          limit: () => q,
          eq(key: string) {
            if (key === "assistant_key") keyed = true;
            return q;
          },
          maybeSingle: async () =>
            legacy && keyed
              ? { data: null, error: { code: "42703", message: "assistant_key missing" } }
              : { data: rows[table], error: null },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: rows[table], error: null }).then(resolve);
          },
        };
        return q;
      },
    } as never,
  };
}
describe("official studio preparation sources", () => {
  const prompt =
    "Exotic Pole — EXPRESIÓN\n• Qué llevar: rodilleras y ropa cómoda que deje la piel en contacto con el tubo.\n• Cupo: 9.";
  it.each([false, true])("reads the active saved prompt (legacy=%s)", async (legacy) => {
    expect(await getStudioInformation(context(null, prompt, legacy))).toMatchObject({
      first_class_preparation:
        "Exotic Pole: rodilleras y ropa cómoda que deje la piel en contacto con el tubo.",
      first_class_preparation_source: "active_studio_prompt",
    });
  });
  it("gives the dedicated rule precedence over prompt guidance", async () => {
    expect(await getStudioInformation(context("Indicaciones nuevas.", prompt))).toMatchObject({
      first_class_preparation: "Indicaciones nuevas.",
      first_class_preparation_source: "first_class_preparation_rule",
    });
  });
  it("reports missing guidance when neither source specifies what to bring", async () => {
    expect(await getStudioInformation(context(null, "Habla cálidamente."))).toMatchObject({
      first_class_preparation: null,
      first_class_preparation_source: null,
    });
  });
});
