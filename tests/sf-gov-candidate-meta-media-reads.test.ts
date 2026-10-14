import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireBuiltin = createRequire(import.meta.url);
const forbidden = (effect: string) => {
  throw new Error(`candidate_preview_external_effect_forbidden:${effect}`);
};

function load(path: string) {
  const loaded = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      if (name === "node:crypto") return requireBuiltin(name);
      if (name === "./uat-scope") return { demiUatScope: () => null };
      if (name === "./external-effect-policy")
        return { assertCandidateRuntimeExternalEffectAllowed: forbidden };
      throw new Error(name);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports as Record<string, (...args: any[]) => Promise<unknown>>;
}

afterEach(() => vi.unstubAllGlobals());

describe("SF-GOV-001 Candidate Meta media network denial", () => {
  it("blocks WhatsApp media metadata and download before either network request", async () => {
    const network = vi.fn();
    const whatsapp = load("lib/assistant/meta-whatsapp-channel.ts");
    await expect(
      whatsapp.downloadMetaWhatsAppMedia({
        config: {
          graphApiVersion: "v21.0",
          phoneNumberId: "123",
          accessToken: "synthetic-test-only",
        },
        mediaId: "1234",
        fetcher: network,
      }),
    ).rejects.toThrow("candidate_preview_external_effect_forbidden:meta_whatsapp_media_read");
    expect(network).not.toHaveBeenCalled();
  });

  it("blocks Inbox media CDN download before making a network request", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const inbox = load("lib/assistant/meta-inbox-channel.ts");
    await expect(
      inbox.downloadMetaInboxAttachment("https://cdn.fbcdn.net/synthetic-file", "audio"),
    ).rejects.toThrow("candidate_preview_external_effect_forbidden:meta_inbox_media_read");
    expect(network).not.toHaveBeenCalled();
  });
});
