import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "app/api/integrations/meta-whatsapp/webhook/route.ts"),
  "utf8",
);

describe("DEMI-378 pre-delivery guard", () => {
  it("checks for newer text after generation and before sending the generated reply", () => {
    const postAssistant = route.indexOf("// DEMI-BATCH-02: do not send an answer");
    const preDelivery = route.indexOf("// Recheck immediately before delivery;");
    const generatedDelivery = route.indexOf("text: assistantResult.reply,");
    expect(postAssistant).toBeGreaterThan(-1);
    expect(preDelivery).toBeGreaterThan(postAssistant);
    expect(generatedDelivery).toBeGreaterThan(preDelivery);
    expect(route.slice(preDelivery, generatedDelivery)).toContain(
      "await findNewerConversationText(newerTextScope)",
    );
    expect(route.slice(preDelivery, generatedDelivery)).toContain(
      'outcome: "superseded_before_delivery"',
    );
    expect(route.slice(preDelivery, generatedDelivery)).toContain(
      'outcome: "message_batch_pre_delivery_lookup_failed"',
    );
  });
  it("guards cached text retries against newer inbound messages", () => {
    const cachedBranch = route.indexOf("if (sendReplies && cachedReply)");
    const cachedDelivery = route.indexOf("text: cachedReply,");
    expect(cachedBranch).toBeGreaterThan(-1);
    expect(cachedDelivery).toBeGreaterThan(cachedBranch);
    const guardedPath = route.slice(cachedBranch, cachedDelivery);
    expect(guardedPath).toContain("await findNewerConversationText({");
    expect(guardedPath).toContain('outcome: "cached_reply_superseded"');
    expect(guardedPath).toContain('outcome: "cached_reply_newer_text_lookup_failed"');
  });
  it("gates both text delivery paths with atomic claims", () => {
    expect(route.split("await reserveTextDelivery({")).toHaveLength(3);
    expect(route.split("await completeTextDelivery({")).toHaveLength(5);
    expect(route).toContain('process.env.DEMI_ATOMIC_TEXT_SEND_CLAIMS === "true"');
  });

});
