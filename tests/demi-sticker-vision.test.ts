import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
import { stickerVisionFrames } from "@/lib/assistant/sticker-media";
import { runAssistantTurn } from "@/lib/assistant/orchestrator";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const fixture = (name: string) => readFileSync(`tests/fixtures/demi-stickers/${name}.webp`);

function runtime(budget = false) {
  const writes: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        order: () => chain,
        insert(row: Record<string, unknown>) {
          writes.push({ table, row });
          return chain;
        },
        single: async () => ({ data: { id: "model-call" }, error: null }),
        then(resolve: (result: unknown) => void) {
          return Promise.resolve({
            data:
              table === "assistant_model_calls" && budget
                ? [{ estimated_cost_usd_micros: 100 }]
                : [],
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
  };
  return {
    writes,
    input: {
      supabase: client as never,
      studio: {
        id: "isolated-studio",
        name: "Estudio UAT",
        timezone: "America/Mexico_City",
        currency: "MXN",
      },
      config: {
        assistant_name: "Demi",
        model: "gpt-5.6-luna",
        reasoning_effort: "none" as const,
        personality_instructions: "Sé cercana.",
        monthly_budget_usd_micros: 100,
        conversation_budget_usd_micros: 100,
        max_model_calls_per_turn: 1,
        max_tool_calls_per_turn: 5,
      },
      conversationId: "conversation",
      turnId: "turn",
      studentId: "student",
      crmContactId: null,
      serviceMode: true,
      activationUrl: null,
      history: [
        { role: "assistant" as const, content: "¿Confirmas la reserva?" },
        { role: "user" as const, content: "sí" },
      ],
      stickerImages: ["data:image/png;base64,YQ=="],
    },
  };
}

describe("Demi sticker vision", () => {
  it("normalizes a static WebP to one bounded PNG", async () => {
    const frames = await stickerVisionFrames(fixture("saludo"));
    expect(frames).toHaveLength(1);
    const meta = await sharp(Buffer.from(frames[0].split(",")[1], "base64")).metadata();
    expect(meta).toMatchObject({ format: "png", width: 512, height: 512 });
  });
  it("samples first, middle and last frames of an animation", async () => {
    const frames = await stickerVisionFrames(fixture("animado"));
    expect(frames).toHaveLength(3);
    expect(new Set(frames).size).toBe(3);
  });
  it("rejects corrupt, disguised and oversized content", async () => {
    await expect(stickerVisionFrames(new Uint8Array([1, 2]))).rejects.toThrow();
    await expect(stickerVisionFrames(new Uint8Array(1024 * 1024 + 1))).rejects.toThrow(
      "sticker_size_invalid",
    );
    const png = await sharp(fixture("saludo")).png().toBuffer();
    await expect(stickerVisionFrames(png)).rejects.toThrow("sticker_format_invalid");
  });
  it("passes images and conversation to the existing budgeted runtime with no tools or server confirmation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "response",
        model: "gpt-5.6-luna",
        output: [{ type: "message", content: [{ type: "output_text", text: "¡Hola! 😊" }] }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { input, writes } = runtime();
    const result = await runAssistantTurn(input);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.tools).toEqual([]);
    expect(body.tool_choice).toBe("none");
    expect(body.input.at(-1).content[1]).toMatchObject({
      type: "input_image",
      image_url: input.stickerImages[0],
    });
    expect(body.input[0].content).toBe("¿Confirmas la reserva?");
    expect(result.reply).toBe("¡Hola! 😊");
    expect(result.trace.toolCalls).toEqual([]);
    expect(writes.map((w) => w.table)).toEqual(["assistant_model_calls"]);
    expect(writes[0].row.input_tokens).toBe(100);
  });
  it("blocks a provider tool call even if unexpectedly returned", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          output: [{ type: "function_call", name: "execute_booking", arguments: "{}" }],
        }),
      ),
    );
    const { input, writes } = runtime();
    await expect(runAssistantTurn(input)).rejects.toThrow("sticker_tool_call_blocked");
    expect(writes.every((w) => w.table === "assistant_model_calls")).toBe(true);
  });
  it("preserves the monthly and conversation budget gate", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(runAssistantTurn(runtime(true).input)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
