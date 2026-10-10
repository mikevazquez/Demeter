import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDemiUatEnvironment } from "../lib/assistant/uat-environment";
vi.mock("server-only", () => ({}));
import { withDemiUatScope, demiUatScope } from "../lib/assistant/uat-scope";
import {
  sendMetaWhatsAppText,
  downloadMetaWhatsAppMedia,
  loadMetaWhatsAppWebhookConfig,
  type MetaWhatsAppWebhookConfig,
} from "../lib/assistant/meta-whatsapp-channel";

const url = "https://hedouonyhynuvwbckdlg.supabase.co";
const config: MetaWhatsAppWebhookConfig = {
  accessToken: "capture",
  phoneNumberId: "999",
  wabaId: "998",
  graphApiVersion: "v23.0",
  appSecret: "secret",
  verifyToken: "verify",
  pilotWaIds: [],
  languageCode: "es_MX",
  countryCallingCode: "52",
  templates: {},
};
function scope(failed = false) {
  return {
    runId: "run",
    studioId: "studio",
    config,
    media: new Map(),
    supabase: {
      rpc: vi.fn().mockResolvedValue({
        data: { artifact_id: "artifact", failed, captured: true },
        error: null,
      }),
    } as unknown as SupabaseClient,
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Demi operational UAT isolation", () => {
  it.each([
    undefined,
    "https://qfhojvgvhrbautvczffq.supabase.co",
    "https://hedouonyhynuvwbckdlg.supabase.co.evil.test",
    "http://hedouonyhynuvwbckdlg.supabase.co",
    "https://user:password@hedouonyhynuvwbckdlg.supabase.co",
  ])("denies unsafe environment %s", (unsafe) => {
    expect(() => assertDemiUatEnvironment(unsafe)).toThrow("demi_uat_sandbox_required");
  });
  it("denies production even with Sandbox URL", () => {
    expect(() => assertDemiUatEnvironment(url, "production")).toThrow();
  });
  it("allows exact Sandbox preview", () => {
    expect(() => assertDemiUatEnvironment(url, "preview")).not.toThrow();
  });
  it("captures the real channel contract without external fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetcher = vi.fn();
    const s = scope();
    await withDemiUatScope(s, async () => {
      expect(await loadMetaWhatsAppWebhookConfig(s.supabase, "studio")).toBe(config);
      const result = await sendMetaWhatsAppText({
        config,
        recipientWaId: "529990000001",
        text: "Confirmada",
        fetcher,
      });
      expect(result).toMatchObject({ status: "accepted", providerMessageId: "uat:artifact" });
      expect(s.supabase.rpc).toHaveBeenCalledWith(
        "service_capture_demi_uat_delivery",
        expect.objectContaining({ p_studio: "studio", p_kind: "whatsapp_reply" }),
      );
      expect(fetcher).not.toHaveBeenCalled();
      expect(() => demiUatScope("another-studio")).toThrow("demi_uat_tenant_mismatch");
    });
    expect(demiUatScope()).toBeNull();
  });
  it("reports failures and fails closed if capture cannot persist", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    const s = scope(true);
    await withDemiUatScope(s, async () => {
      expect(
        await sendMetaWhatsAppText({ config, recipientWaId: "529990000001", text: "Hola" }),
      ).toMatchObject({ status: "error", retryable: true });
      vi.mocked(s.supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: new Error("unavailable"),
      } as never);
      await expect(
        sendMetaWhatsAppText({ config, recipientWaId: "529990000001", text: "Hola" }),
      ).rejects.toThrow("demi_uat_capture_failed");
    });
  });
  it("reads only scoped media; cannot fall back to provider download", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    const s = scope();
    const bytes = new Uint8Array([1, 2, 3]);
    s.media.set("123", { bytes, mimeType: "image/png", fileSize: 3 });
    const fetcher = vi.fn();
    await withDemiUatScope(s, async () => {
      expect((await downloadMetaWhatsAppMedia({ config, mediaId: "123", fetcher })).bytes).toBe(
        bytes,
      );
      await expect(downloadMetaWhatsAppMedia({ config, mediaId: "456", fetcher })).rejects.toThrow(
        "demi_uat_media_missing",
      );
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
