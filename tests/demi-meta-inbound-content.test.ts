import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
const loaded = { exports: {} };
const requireBuiltin = createRequire(import.meta.url);
new Function(
  "require",
  "module",
  "exports",
  transformSync(readFileSync("lib/assistant/meta-whatsapp-channel.ts", "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code,
)(
  (name: string) => {
    if (name === "server-only" || name === "./uat-scope") return {};
    if (name === "node:crypto") return requireBuiltin(name);
    throw new Error(name);
  },
  loaded,
  loaded.exports,
);
const { extractMetaInboundMessages } =
  loaded.exports as typeof import("../lib/assistant/meta-whatsapp-channel");
function envelope(message: Record<string, unknown>) {
  return {
    entry: [
      {
        id: "waba",
        changes: [
          {
            value: {
              metadata: { phone_number_id: "phone" },
              messages: [{ id: "message", from: "523300000000", ...message }],
            },
          },
        ],
      },
    ],
  };
}
describe("Meta first contact normalization", () => {
  it("preserves usable text even when Meta labels the message unsupported", () => {
    const [message] = extractMetaInboundMessages(
      envelope({
        type: "unsupported",
        text: { body: "Quiero empezar Pole desde cero. Quiero agendar." },
        referral: { source_type: "ad", source_id: "ad-id" },
      }),
    );
    expect(message.messageType).toBe("text");
    expect(message.text).toContain("Quiero agendar");
    expect(message.referralSourceId).toBe("ad-id");
  });
  it("does not fabricate missing text or referral", () => {
    const [message] = extractMetaInboundMessages(envelope({ type: "unsupported" }));
    expect(message.messageType).toBe("unsupported");
    expect(message.referralSourceType).toBeNull();
    expect(message.text).not.toContain("Pole");
  });
  it("preserves genuine images for the receipt flow", () => {
    const [message] = extractMetaInboundMessages(
      envelope({ type: "image", image: { id: "receipt" } }),
    );
    expect(message.messageType).toBe("image");
    expect(message.mediaId).toBe("receipt");
  });
});
