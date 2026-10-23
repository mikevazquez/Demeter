import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_KEY,
  decodeConversationReply,
  loadConversationContext,
  localConversationClock,
  memoryFields,
  saveConversationMemory,
} from "../lib/assistant/conversation-context";

const values = {
  intent: "Primera clase",
  activity: "Pole Fitness",
  availability: "Martes después de las 18:00",
  selected_option: null,
  next_step: "Revisar otra fecha",
};

function fixture() {
  let row: Record<string, unknown> = {
    student_id: "student",
    context: { human_takeover: false, unrelated: "preserved" },
    updated_at: "2026-10-21T10:00:00.000Z",
  };
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; write: unknown }> = [];
  let conflict: (() => void) | null = null;
  const db = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]>, write: null as unknown };
      queries.push(query);
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          query.filters.push([key, value]);
          return chain;
        },
        update: (value: unknown) => {
          query.write = value;
          return chain;
        },
        maybeSingle: async () => {
          if (query.write) {
            if (conflict) {
              conflict();
              conflict = null;
              return { data: null, error: null };
            }
            if (query.filters.find(([k]) => k === "updated_at")?.[1] !== row.updated_at)
              return { data: null, error: null };
            row = { ...row, ...(query.write as object) };
            return { data: { id: "conversation" }, error: null };
          }
          return { data: row, error: null };
        },
      };
      return chain;
    },
  };
  return {
    scope: {
      supabase: db as never,
      studioId: "studio",
      conversationId: "conversation",
      studentId: "student",
      crmContactId: null,
      turnId: "turn",
    },
    queries,
    row: () => row,
    replace: (value: Record<string, unknown>) => (row = value),
    conflict: (callback: () => void) => (conflict = callback),
  };
}

afterEach(() => vi.useRealTimers());

describe("Demi durable conversation context", () => {
  it("separates the customer reply from bounded internal memory", () => {
    const result = decodeConversationReply(
      JSON.stringify({ reply: "Busco otro día.", memory: values }),
    );
    expect(result.reply).toBe("Busco otro día.");
    expect(result.reply).not.toContain("next_step");
    expect(result.memory).toEqual(values);
    expect(memoryFields({ ...values, availability: "x".repeat(1000) })?.availability).toHaveLength(
      320,
    );
    expect(memoryFields({ activity: "Pole" })).toBeNull();
  });

  it("does not leak an invalid or incomplete structured response into chat", () => {
    expect(() => decodeConversationReply('{"reply":')).toThrow(
      "assistant_invalid_structured_reply",
    );
    expect(() => decodeConversationReply('{"memory":{}}')).toThrow(
      "assistant_invalid_structured_reply",
    );
    expect(decodeConversationReply("Hola").reply).toBe("Hola");
  });

  it("stores and recovers preferences independently of the short message window", async () => {
    const f = fixture();
    const loaded = await loadConversationContext(f.scope);
    expect(await saveConversationMemory(f.scope, loaded, values)).toBe(true);
    const recovered = await loadConversationContext({ ...f.scope, turnId: "tomorrow-turn" });
    expect(recovered?.memory?.availability).toBe("Martes después de las 18:00");
    expect(recovered?.memory?.turn_id).toBe("turn");
    expect((f.row().context as Record<string, unknown>).unrelated).toBe("preserved");
    for (const q of f.queries) {
      expect(q.table).toBe("assistant_conversations");
      expect(q.filters).toContainEqual(["studio_id", "studio"]);
      expect(q.filters).toContainEqual(["id", "conversation"]);
    }
  });

  it("discards memory from a different subject and rejects a mismatched student", async () => {
    const f = fixture();
    f.replace({
      ...f.row(),
      context: {
        [MEMORY_KEY]: {
          ...values,
          version: 1,
          subject: "contact:other",
          turn_started_at: 1,
          turn_id: "old",
        },
      },
    });
    expect((await loadConversationContext(f.scope))?.memory).toBeNull();
    await expect(loadConversationContext({ ...f.scope, studentId: "other" })).rejects.toThrow(
      "conversation_identity_mismatch",
    );
  });

  it("merges unrelated changes when a concurrent write wins the first attempt", async () => {
    const f = fixture();
    const loaded = await loadConversationContext(f.scope);
    f.conflict(() =>
      f.replace({
        ...f.row(),
        updated_at: "2026-10-21T10:01:00Z",
        context: { human_takeover: true },
      }),
    );
    expect(await saveConversationMemory(f.scope, loaded, values)).toBe(true);
    expect((f.row().context as Record<string, unknown>).human_takeover).toBe(true);
  });

  it("does not overwrite memory from a newer incoming turn", async () => {
    const f = fixture();
    const loaded = await loadConversationContext(f.scope);
    f.conflict(() =>
      f.replace({
        ...f.row(),
        updated_at: "2026-10-21T10:01:00Z",
        context: {
          [MEMORY_KEY]: {
            ...values,
            availability: "Viernes",
            version: 1,
            subject: "student:student",
            turn_started_at: loaded!.turnStartedAt + 1000,
            turn_id: "newer",
          },
        },
      }),
    );
    expect(await saveConversationMemory(f.scope, loaded, values)).toBe(false);
    expect(
      ((f.row().context as Record<string, unknown>)[MEMORY_KEY] as Record<string, unknown>)
        .availability,
    ).toBe("Viernes");
  });

  it("uses the study timezone across the UTC date boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T01:30:00Z"));
    expect(localConversationClock("America/Mexico_City")).toBe("2026-10-21 19:30");
  });
});
