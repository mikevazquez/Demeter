import { describe, expect, it } from "vitest";

import {
  contextInstructions,
  conversationResponseFormat,
  decodeConversationReply,
} from "../lib/assistant/conversation-context";

describe("Demi memory only when it changes (latency)", () => {
  it("lets the model return memory=null to keep the stored memory", () => {
    const memory = conversationResponseFormat.schema.properties.memory as {
      anyOf: Array<{ type: string }>;
    };
    expect(memory.anyOf.map((option) => option.type)).toEqual(["object", "null"]);
    expect(conversationResponseFormat.schema.required).toEqual(["reply", "memory"]);
  });

  it("decodes a reply without memory and does not invent one", () => {
    expect(decodeConversationReply(JSON.stringify({ reply: "¡Hola!", memory: null }))).toEqual({
      reply: "¡Hola!",
      memory: null,
    });
  });

  it("instructs short labels and null when nothing changed", () => {
    const text = contextInstructions({ status: null, reservations: null }, null);
    expect(text).toContain("Devuelve memory=null");
    expect(text).toContain("menos de 40 caracteres");
  });
});
