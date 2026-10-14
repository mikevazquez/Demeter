import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertCandidateRuntimeExternalEffectAllowed } from "../lib/assistant/external-effect-policy";
import { AsistianMessagingProvider } from "../lib/automations/asistian-provider";

function load<T>(path: string): T {
  const mod = { exports: {} };
  const config = {
    phoneNumberId: "synthetic",
    wabaId: "synthetic",
    accessToken: "invalid-test-token",
    graphApiVersion: "v21.0",
    templates: {},
    languageCode: "es_MX",
  };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code,
  )(
    (id: string) => {
      if (id === "server-only") return {};
      if (id === "./external-effect-policy") return { assertCandidateRuntimeExternalEffectAllowed };
      if (id === "@/lib/supabase/service") return { createServiceClient: () => ({}) };
      if (id === "@/lib/assistant/meta-whatsapp-channel")
        return { loadMetaWhatsAppWebhookConfig: async () => config };
      if (id === "@/lib/phone") return { normalizeMexicanPhone: () => "+520000000000" };
      if (id === "@/lib/notifications/meta-template-catalog")
        return { validateMetaWhatsAppTemplateDraft: () => null };
      throw new Error(`unexpected_import:${id}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports as T;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(["candidate_public", "candidate_server", "preview_without_flag"])(
  "B02 uncovered provider paths: %s",
  (target) => {
    function deny() {
      vi.stubEnv("VERCEL_ENV", target === "preview_without_flag" ? "preview" : "development");
      vi.stubEnv("SF_GOV_CANDIDATE_PREVIEW", "0");
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_URL",
        target === "candidate_public"
          ? "https://sdmxtlgjkodidjtvikng.supabase.co"
          : "https://hedouonyhynuvwbckdlg.supabase.co",
      );
      vi.stubEnv(
        "SUPABASE_URL",
        target === "candidate_server"
          ? "https://sdmxtlgjkodidjtvikng.supabase.co"
          : "https://hedouonyhynuvwbckdlg.supabase.co",
      );
      vi.stubEnv("OPENAI_API_KEY", "invalid-synthetic-key");
      const network = vi.fn(() => {
        throw new Error("unexpected_network");
      });
      vi.stubGlobal("fetch", network);
      return network;
    }

    it("blocks receipt OCR before OpenAI receives bytes", async () => {
      const network = deny();
      const reader = load<typeof import("../lib/assistant/receipt-reader")>(
        "lib/assistant/receipt-reader.ts",
      );
      await expect(
        reader.readTransferReceipt({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
      ).rejects.toThrow("candidate_preview_external_effect_forbidden:openai_responses");
      expect(network).not.toHaveBeenCalled();
    });

    it("blocks administrative copilot before a billable model request", async () => {
      const network = deny();
      const copilot = load<typeof import("../lib/assistant/admin-copilot")>(
        "lib/assistant/admin-copilot.ts",
      );
      await expect(
        copilot.proposeDemiAdminPlan({ instruction: "synthetic", state: {} }),
      ).rejects.toThrow("candidate_preview_external_effect_forbidden:openai_responses");
      expect(network).not.toHaveBeenCalled();
    });

    it("blocks Meta subscription writes and diagnostic reads", async () => {
      const network = deny();
      const meta = load<typeof import("../lib/assistant/meta-whatsapp-admin")>(
        "lib/assistant/meta-whatsapp-admin.ts",
      );
      await expect(meta.subscribeMetaWhatsAppApp("synthetic-studio")).rejects.toThrow(
        "candidate_preview_external_effect_forbidden:meta_admin_request",
      );
      const diagnostics = await meta.getMetaWhatsAppAdminDiagnostics("synthetic-studio");
      expect(diagnostics.connected).toBe(false);
      expect(network).not.toHaveBeenCalled();
    });

    it("blocks Asistian dispatch without treating policy denial as retryable", async () => {
      const network = deny();
      const provider = new AsistianMessagingProvider({
        webhookUrls: { synthetic: "https://example.invalid/hook" },
        fetcher: network,
      });
      const result = await provider.send({
        recipient: "synthetic-recipient",
        template: "synthetic",
        variables: {},
        executionId: "synthetic",
        metadata: {},
      });
      expect(result).toMatchObject({
        status: "error",
        errorCode: "candidate_preview_external_effect_forbidden",
        retryable: false,
      });
      expect(network).not.toHaveBeenCalled();
    });
  },
);
