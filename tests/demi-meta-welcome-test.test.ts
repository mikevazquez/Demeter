import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
function load(rows: unknown[]) {
  const request = vi.fn(async () => Response.json({ data: rows }));
  vi.stubGlobal("fetch", request);
  const loadedModule = { exports: {} };
  const config = {
    wabaId: "test-waba",
    phoneNumberId: "test-phone",
    graphApiVersion: "v23.0",
    accessToken: "test-token",
  };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync("lib/assistant/meta-whatsapp-admin.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      if (name.endsWith("meta-whatsapp-channel"))
        return { loadMetaWhatsAppWebhookConfig: async () => config };
      if (name.endsWith("supabase/service")) return { createServiceClient: () => ({}) };
      if (name.endsWith("phone")) return { normalizeMexicanPhone: () => "+523323291878" };
      if (name.endsWith("meta-template-catalog")) return {};
      throw Error(name);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports as typeof import("../lib/assistant/meta-whatsapp-admin");
}
afterEach(() => vi.unstubAllGlobals());
describe("Meta UAT uses real compatible approved welcome definitions", () => {
  it("uses the one body variable from the approved provider definition", async () => {
    const h = load([
      {
        name: "demeter_bienvenida",
        status: "APPROVED",
        language: "es_MX",
        components: [{ type: "BODY", text: "Hola {{1}}, bienvenida." }],
      },
    ]);
    expect(await h.getMetaWhatsAppUatWelcome("studio")).toEqual({
      name: "demeter_bienvenida",
      language: "es_MX",
      bodyParameters: ["Prueba UAT Demi"],
    });
  });
  it.each(
    [
      [
        { type: "BODY", text: "Hola {{1}}" },
        { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.test/{{1}}" }] },
      ],
      [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Hola {{1}}" },
      ],
      [{ type: "BODY", text: "Hola {{1}}, pago {{2}}" }],
    ].map((components) => ({ components })),
  )(
    "rejects unsupported headers, dynamic buttons and extra body variables",
    async ({ components }) => {
      const h = load([
        { name: "demeter_bienvenida", status: "APPROVED", language: "es_MX", components },
      ]);
      expect(await h.getMetaWhatsAppUatWelcome("studio")).toBeNull();
    },
  );
});
