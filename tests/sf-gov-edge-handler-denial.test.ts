import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const paths = [
  "create-mercadopago-order",
  "create-demi-mercadopago-order",
  "demi-payment-worker",
  "mercadopago-webhook",
  "reconcile-mercadopago-order",
  "send-push-notification",
  "notification-delivery-worker",
  "demi-followup-worker",
];

function policy() {
  const loadedPolicy = {
    exports: {} as { candidateExternalEffectsBlocked: (flag?: string, url?: string) => boolean },
  };
  new Function(
    "module",
    "exports",
    transformSync(readFileSync("supabase/functions/_shared/candidate-external-policy.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(loadedPolicy, loadedPolicy.exports);
  return loadedPolicy.exports;
}

afterEach(() => vi.unstubAllGlobals());

describe.each(paths)("B02 real Edge handler (Node adapter): %s", (path) => {
  it.each([undefined, "", "0", "1"])(
    "denies Candidate with flag %s before payload, DB or provider access",
    async (flag) => {
      const effects = vi.fn(() => {
        throw new Error("unexpected_side_effect");
      });
      vi.stubGlobal("fetch", effects);
      let callback: ((request: Request, context?: unknown) => Promise<Response>) | undefined;
      const mod = { exports: {} as { default?: { fetch: typeof callback } } };
      const deno = {
        env: {
          get: (name: string) =>
            name === "SUPABASE_URL"
              ? "https://sdmxtlgjkodidjtvikng.supabase.co"
              : name === "SF_GOV_CANDIDATE_PREVIEW"
                ? flag
                : undefined,
        },
        serve: (fn: typeof callback) => {
          callback = fn;
        },
      };
      new Function(
        "require",
        "module",
        "exports",
        "Deno",
        transformSync(readFileSync(`supabase/functions/${path}/index.ts`, "utf8"), {
          loader: "ts",
          format: "cjs",
        }).code,
      )(
        (id: string) => {
          if (id.includes("candidate-external-policy")) return policy();
          if (id.startsWith("npm:@supabase/server"))
            return { withSupabase: (_options: unknown, fn: typeof callback) => fn };
          if (id.startsWith("npm:@supabase/supabase-js")) return { createClient: effects };
          if (id.includes("web-push"))
            return { sendPushNotification: effects, WebPushError: class extends Error {} };
          if (id.includes("asistian-messaging")) return { sendAsistianWebhook: effects };
          if (id.includes("meta-whatsapp.ts")) return { sendMetaWhatsAppTemplate: effects };
          if (id.includes("demi-mercadopago"))
            return { demiTestSeller: effects, demiOrderBody: effects, demiCheckoutUrl: effects };
          if (id.startsWith("jsr:") || id.startsWith("../_shared/")) return {};
          throw new Error(`unexpected_import:${id}`);
        },
        mod,
        mod.exports,
        deno,
      );
      const handler = callback ?? mod.exports.default?.fetch;
      if (!handler) throw new Error("handler_missing");
      const request = new Request("https://candidate.invalid/test", {
        method: "POST",
        body: "invalid-json",
      });
      const parse = vi.spyOn(request, "json");
      const context = new Proxy({}, { get: effects });
      const response = await handler(request, context);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "candidate_external_effect_forbidden" });
      expect(parse).not.toHaveBeenCalled();
      expect(effects).not.toHaveBeenCalled();
    },
  );
});
