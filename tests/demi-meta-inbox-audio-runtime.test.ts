import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
function load() {
  const loaded = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync("lib/assistant/meta-inbox-channel.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      if (name === "node:crypto") return crypto;
      if (name === "./uat-scope") return { demiUatScope: () => null };
      throw new Error(name);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports as {
    extractMetaInboxMessages: (body: unknown) => Array<{
      messageType: string;
      attachmentType: string;
      attachmentUrl: string;
      text: string;
    }>;
    downloadMetaInboxAttachment: (
      url: string,
      kind?: string,
    ) => Promise<{ mimeType: string; bytes: Uint8Array }>;
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("Meta inbox audio classification and bounded download", () => {
  it.each(["page", "instagram"])("keeps %s audio separate from receipts", (object) => {
    const result = load().extractMetaInboxMessages({
      object,
      entry: [
        {
          id: "account",
          messaging: [
            {
              sender: { id: "person" },
              recipient: { id: "account" },
              message: {
                mid: "audio-id",
                attachments: [{ type: "audio", payload: { url: "https://cdn.fbcdn.net/audio" } }],
              },
            },
          ],
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageType: "attachment",
      attachmentType: "audio",
      attachmentUrl: "https://cdn.fbcdn.net/audio",
      text: "[audio recibido]",
    });
  });
  it.each(["video", "location"])("marks %s as a non-receipt attachment", (type) => {
    const messages = load().extractMetaInboxMessages({
      object: "page",
      entry: [
        {
          id: "account",
          messaging: [
            {
              sender: { id: "person" },
              recipient: { id: "account" },
              message: {
                mid: "unsupported-id",
                attachments: [{ type, payload: { url: "https://cdn.fbcdn.net/attachment" } }],
              },
            },
          ],
        },
      ],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].attachmentType).toBe(type === "video" ? "video" : "unsupported");
  });
  it("accepts the audio MIME only on the audio download path", async () => {
    const request = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", request);
    const h = load();
    expect(
      (await h.downloadMetaInboxAttachment("https://cdn.fbcdn.net/audio", "audio")).mimeType,
    ).toBe("audio/mpeg");
    await expect(h.downloadMetaInboxAttachment("https://cdn.fbcdn.net/audio")).rejects.toThrow(
      "meta_attachment_type_unsupported",
    );
    expect((request.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({
      redirect: "error",
    });
  });
  it("rejects private hosts before downloading", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      load().downloadMetaInboxAttachment("https://127.0.0.1/audio", "audio"),
    ).rejects.toThrow("meta_attachment_url_forbidden");
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects an oversized audio before reading it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            headers: { "content-type": "audio/ogg", "content-length": String(11 * 1024 * 1024) },
          }),
      ),
    );
    await expect(
      load().downloadMetaInboxAttachment("https://cdn.fbcdn.net/audio", "audio"),
    ).rejects.toThrow("meta_attachment_too_large");
  });
});
