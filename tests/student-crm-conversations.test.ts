import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { contactConversations } from "../lib/student-crm-conversations";

type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let calls: Array<{ table: string; key: string; value: unknown }>;
function from(table: string) {
  let data = rows[table] ?? [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      calls.push({ table, key, value });
      data = data.filter((row) => row[key] === value);
      return query;
    },
    in: (key: string, values: unknown[]) => {
      data = data.filter((row) => values.includes(row[key]));
      return query;
    },
    order: (key: string) => {
      data = [...data].sort((a, b) => String(b[key]).localeCompare(String(a[key])));
      return query;
    },
    limit: (limit: number) => {
      data = data.slice(0, limit);
      return query;
    },
    then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return query;
}
const client = { from } as unknown as SupabaseClient;
beforeEach(() => {
  calls = [];
  rows = {
    crm_conversations: [
      {
        id: "crm",
        student_id: "student",
        crm_contact_id: "prospect",
        channel: "whatsapp",
        studio_id: "studio",
        last_activity_at: "2026-10-09",
      },
    ],
    assistant_conversations: [
      {
        id: "conversation",
        student_id: "student",
        crm_conversation_id: "crm",
        channel: "whatsapp",
        studio_id: "studio",
      },
    ],
    assistant_turns: [
      {
        id: "older",
        conversation_id: "conversation",
        content: "Hola",
        direction: "inbound",
        role: "user",
        studio_id: "studio",
        created_at: "2026-10-08",
      },
      {
        id: "newest",
        conversation_id: "conversation",
        content: "Respuesta",
        direction: "outbound",
        role: "assistant",
        studio_id: "studio",
        created_at: "2026-10-09",
      },
      {
        id: "internal",
        conversation_id: "conversation",
        content: "Private tool payload",
        direction: "system",
        role: "tool",
        studio_id: "studio",
        created_at: "2026-10-10",
      },
      {
        id: "other",
        conversation_id: "conversation",
        content: "Other studio",
        direction: "inbound",
        role: "user",
        studio_id: "other",
        created_at: "2026-10-10",
      },
    ],
  };
});
describe("CRM conversation access", () => {
  it("keeps content unread when the role has no assistant permission", async () => {
    const result = await contactConversations(client, "studio", ["student"], [], false);
    expect(result.messages.size).toBe(0);
    expect(result.channels.get("student")).toBe("whatsapp");
    expect(calls.some((call) => call.table.startsWith("assistant_"))).toBe(false);
  });
  it("scopes every conversation read and excludes tool and other-studio messages", async () => {
    const result = await contactConversations(client, "studio", ["student"], [], true);
    expect(result.messages.get("student")?.map((message) => message.id)).toEqual([
      "newest",
      "older",
    ]);
    for (const table of ["crm_conversations", "assistant_conversations", "assistant_turns"])
      expect(calls).toContainEqual({ table, key: "studio_id", value: "studio" });
  });
  it("links a prospect through its CRM conversation without duplicating messages", async () => {
    const result = await contactConversations(client, "studio", ["student"], ["prospect"], true);
    expect(result.messages.get("prospect")?.map((message) => message.id)).toEqual([
      "newest",
      "older",
    ]);
  });
  it("excludes internal demo conversations from the real contact history", async () => {
    rows.assistant_conversations[0].channel = "internal_demo";
    const result = await contactConversations(client, "studio", ["student"], [], true);
    expect(result.messages.size).toBe(0);
  });
  it("returns an empty state when the contact has no recorded conversation", async () => {
    const result = await contactConversations(client, "studio", ["unknown"], [], true);
    expect(result.messages.size).toBe(0);
    expect(result.unavailable).toBe(false);
  });
});
