import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

// Execute the actual server module without importing Next's server-only marker.
function loadVerifier() {
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
  return (
    loaded.exports as {
      verifyMetaInboxWebhookSignature: (
        secret: string,
        body: Buffer,
        signature: string | null,
      ) => boolean;
    }
  ).verifyMetaInboxWebhookSignature;
}

const verify = loadVerifier();
const instagramKey = "synthetic-instagram-key";
const messengerKey = "synthetic-messenger-key";
const body = Buffer.from('{"object":"instagram","entry":[],"text":"¡Hola! 🩰"}');
const sign = (key: string, bytes: Buffer) =>
  `sha256=${crypto.createHmac("sha256", key).update(bytes).digest("hex")}`;

describe("Meta Inbox signing keys", () => {
  it("accepts Instagram's exact UTF-8 bytes with its own key", () => {
    expect(verify(instagramKey, body, sign(instagramKey, body))).toBe(true);
  });

  it("rejects Messenger's signature when verifying Instagram", () => {
    expect(verify(instagramKey, body, sign(messengerKey, body))).toBe(false);
  });

  it("rejects Instagram's signature when verifying Messenger", () => {
    const pageBody = Buffer.from('{"object":"page","entry":[]}');
    expect(verify(messengerKey, pageBody, sign(instagramKey, pageBody))).toBe(false);
    expect(verify(messengerKey, pageBody, sign(messengerKey, pageBody))).toBe(true);
  });

  it("rejects payload tampering after signing", () => {
    expect(
      verify(instagramKey, Buffer.concat([body, Buffer.from(" ")]), sign(instagramKey, body)),
    ).toBe(false);
  });

  it.each([null, "", "sha256=xyz", "sha1=" + "a".repeat(64), "sha256=" + "a".repeat(63)])(
    "rejects missing or malformed signature %s",
    (signature) => {
      expect(verify(instagramKey, body, signature)).toBe(false);
    },
  );
});
