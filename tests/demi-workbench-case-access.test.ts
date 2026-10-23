import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as workbench from "../lib/assistant/prompt-workbench";
import { assertDemiUatEnvironment } from "../lib/assistant/uat-environment";

function harness() {
  const prompt = "Instrucciones de prueba";
  const state = {
    persona: "prospect",
    workbenchCase: "S11",
    identityNeedsName: true,
    reservations: [],
    credits: 0,
    transfer: { status: "awaiting_receipt" },
  };
  const context = {
    workbench: true,
    owner: "owner",
    prompt_hash: createHash("sha256").update(prompt).digest("hex"),
    persona: "prospect",
    workbench_case: "S11",
    purpose: "test",
    simulation: state,
  };
  const writes: string[] = [];
  const run = vi.fn().mockResolvedValue({ reply: "Seguimos con el perfil ficticio." });
  const record = vi.fn((value: typeof state) => {
    value.transfer.status = "awaiting_profile";
    return true;
  });
  const supabase = {
    from(table: string) {
      let mutation = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => {
          mutation = true;
          writes.push(table);
          return chain;
        },
        insert: () => {
          mutation = true;
          writes.push(table);
          return chain;
        },
        single: async () => ({ data: { id: "inbound" }, error: null }),
        maybeSingle: async () => ({
          data:
            table === "assistant_conversations" && !mutation
              ? { id: "conversation", context }
              : table === "assistant_conversations"
                ? { id: "conversation" }
                : {},
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === "assistant_turns"
                ? [{ role: "user", content: "comprobante ficticio" }]
                : [],
            error: null,
          }).then(resolve),
      };
      return chain;
    },
  };
  const deps: Record<string, unknown> = {
    "node:crypto": { createHash },
    "next/cache": { revalidatePath: vi.fn() },
    "@/lib/auth/capabilities": { CAPABILITIES: { SETTINGS_WRITE: "settings.write" } },
    "@/lib/auth/admin-context": {
      getAdminContext: vi
        .fn()
        .mockResolvedValue({ supabase, studio: { id: "studio" }, user: { id: "owner" } }),
    },
    "@/lib/assistant/orchestrator": { runAssistantTurn: run },
    "@/lib/assistant/runtime-config": {
      loadDemiRuntimeConfig: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
    "@/lib/assistant/prompt-workbench": workbench,
    "@/lib/assistant/test-simulation": {
      createTestSimulation: () => ({ ...state }),
      initializeTestScenario: vi.fn().mockResolvedValue(true),
      confirmSimulatedProspectName: vi.fn(),
      recordSimulatedTransferReceipt: record,
    },
    "@/lib/assistant/uat-environment": { assertDemiUatEnvironment },
    "@/lib/assistant/admin-copilot": { proposeDemiAdminPlan: vi.fn() },
  };
  const code = transformSync(
    readFileSync("app/admin/integraciones/demi/workbench-actions.ts", "utf8"),
    { loader: "ts", format: "cjs" },
  ).code;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(
    (key: string) => {
      if (!(key in deps)) throw Error(`Unexpected dependency ${key}`);
      return deps[key];
    },
    loadedModule,
    loadedModule.exports,
  );
  const mod =
    loadedModule.exports as typeof import("../app/admin/integraciones/demi/workbench-actions");
  const input = {
    conversationId: "conversation",
    instructions: prompt,
    message: "Envío comprobante ficticio.",
    persona: "prospect",
    workbenchCase: "S11",
    simulationEvent: "matching_transfer_receipt",
  } as const;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://hedouonyhynuvwbckdlg.supabase.co");
  vi.stubEnv("VERCEL_ENV", "preview");
  return { mod, input, context, state, record, run, writes };
}

afterEach(() => vi.unstubAllEnvs());

describe("Workbench case access boundary", () => {
  it("refuses a receipt event for a conversation owned by somebody else", async () => {
    const h = harness();
    h.context.owner = "different-admin";
    expect(await h.mod.testDemiPrompt(h.input)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("refuses to switch case or persona inside an existing conversation", async () => {
    const h = harness();
    expect(await h.mod.testDemiPrompt({ ...h.input, workbenchCase: "S12" })).toEqual({
      ok: false,
      error: "draft_changed",
    });
    expect(await h.mod.testDemiPrompt({ ...h.input, persona: "student" })).toEqual({
      ok: false,
      error: "invalid_workbench_case",
    });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("rejects new case fixtures on production even when the public URL is Sandbox", async () => {
    const h = harness();
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(h.mod.testDemiPrompt(h.input)).rejects.toThrow("demi_uat_sandbox_required");
    expect(h.record).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("does not manufacture a receipt when there is no existing conversation", async () => {
    const h = harness();
    expect(await h.mod.testDemiPrompt({ ...h.input, conversationId: null })).toEqual({
      ok: false,
      error: "purchase_not_pending",
    });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("records an explicitly requested fixture event before the simulated model turn", async () => {
    const h = harness();
    expect(await h.mod.testDemiPrompt(h.input)).toMatchObject({
      ok: true,
      canSimulateReceipt: false,
    });
    expect(h.record).toHaveBeenCalledOnce();
    expect(h.state.transfer.status).toBe("awaiting_profile");
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: null, crmContactId: null, testSimulation: h.state }),
    );
    expect(
      h.writes.every((table) => ["assistant_conversations", "assistant_turns"].includes(table)),
    ).toBe(true);
  });
});
