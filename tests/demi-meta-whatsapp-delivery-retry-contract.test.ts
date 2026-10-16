import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi Meta WhatsApp safe send retry", () => {
  const channel = source("lib/assistant/meta-whatsapp-channel.ts");

  it("bounds rate-limit retries without replaying ambiguous server errors", () => {
    expect(channel).toContain("const retryDelaysMs = [250, 500, 1000, 2000]");
    expect(channel).toContain("for (let attempt = 0; attempt < 5; attempt += 1)");
    expect(channel).toContain("response.status === 429 && attempt < retryDelaysMs.length");
    expect(channel).not.toContain("response.status === 429 || response.status >= 500");
  });

  it("does not retry ambiguous timeout/network failures inline", () => {
    expect(channel).toContain('"meta_whatsapp_timeout"');
    expect(channel).toContain('"meta_whatsapp_network_error"');
  });
});
