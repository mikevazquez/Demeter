import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

function load() {
  const download = vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/ogg",
    fileSize: 3,
  }));
  const loadedModule = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync("lib/assistant/audio-transcription.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      if (name === "./meta-whatsapp-channel") return { downloadMetaWhatsAppMedia: download };
      throw new Error(name);
    },
    loadedModule,
    loadedModule.exports,
  );
  return {
    download,
    transcribe: (
      loadedModule.exports as { transcribeDemiAudio: (input: unknown) => Promise<string> }
    ).transcribeDemiAudio,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Demi audio transcription", () => {
  it("uses audio download restrictions and multipart transcription without exposing credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const h = load();
    const request = vi.fn(async () => Response.json({ text: "  Quiero reservar mañana.  " }));
    vi.stubGlobal("fetch", request);
    expect(await h.transcribe({ config: {}, mediaId: "123" })).toBe("Quiero reservar mañana.");
    expect(h.download).toHaveBeenCalledWith({ config: {}, mediaId: "123", kind: "audio" });
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = options.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("es");
    expect((form.get("file") as File).name).toBe("audio.ogg");
  });
  it("does not download private media when the transcription provider is unavailable", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const h = load();
    await expect(h.transcribe({ config: {}, mediaId: "123" })).rejects.toThrow(
      "audio_model_not_configured",
    );
    expect(h.download).not.toHaveBeenCalled();
  });
  it("does not manufacture text when the provider rejects audio", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 429 })),
    );
    const h = load();
    await expect(h.transcribe({ config: {}, mediaId: "123" })).rejects.toThrow(
      "audio_transcription_http_429",
    );
  });
  it.each(["", " ", "x".repeat(8001)])("rejects unusable transcription", async (text) => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ text })),
    );
    const h = load();
    await expect(h.transcribe({ config: {}, mediaId: "123" })).rejects.toThrow(
      "audio_transcription_unusable",
    );
  });
});
