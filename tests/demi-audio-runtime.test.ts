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
    transcribeBytes: (
      loadedModule.exports as { transcribeDemiAudioBytes: (media: unknown) => Promise<string> }
    ).transcribeDemiAudioBytes,
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
  it.each([
    ["audio/ogg", [0, 0, 0, 28, 102, 116, 121, 112, 105, 115, 111, 109], "audio/mp4", "audio.m4a"],
    ["audio/mp4", [79, 103, 103, 83, 0, 0, 0, 0], "audio/ogg", "audio.ogg"],
  ])(
    "uses the recording container when Meta mislabels %s",
    async (declared, bytes, actual, filename) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      const request = vi.fn(async () => Response.json({ text: "Información, por favor." }));
      vi.stubGlobal("fetch", request);
      await load().transcribeBytes({
        bytes: new Uint8Array(bytes as number[]),
        mimeType: declared,
      });
      const form = (request.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
      const file = form.get("file") as File;
      expect(file.name).toBe(filename);
      expect(file.type).toBe(actual);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(bytes as number[]));
    },
  );
  it("transcribes a downloaded Meta inbox audio without looking up WhatsApp media", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const request = vi.fn(async () => Response.json({ text: "Información de clases, por favor." }));
    vi.stubGlobal("fetch", request);
    const h = load();
    expect(await h.transcribeBytes({ bytes: new Uint8Array([1, 2]), mimeType: "audio/mpeg" })).toBe(
      "Información de clases, por favor.",
    );
    expect(h.download).not.toHaveBeenCalled();
    const body = (request.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((body.get("file") as File).name).toBe("audio.mp3");
  });
  it.each(["application/pdf", "video/mp4", "text/html"])(
    "does not reinterpret %s as audio",
    async (mimeType) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      const request = vi.fn();
      vi.stubGlobal("fetch", request);
      const h = load();
      await expect(h.transcribeBytes({ bytes: new Uint8Array([1]), mimeType })).rejects.toThrow(
        "audio_media_invalid",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
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
