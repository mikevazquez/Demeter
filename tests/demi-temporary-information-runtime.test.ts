import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { executeAssistantReadTool } from "@/lib/assistant/read-tools";

const record = (overrides: Record<string, unknown> = {}) => ({
  id: "workshop-1",
  title: "Taller de aro aéreo",
  kind: "workshop",
  discipline: "Aro aéreo",
  details: "Domingos de 9:00 a 10:30.",
  promotion_starts_on: "2026-10-01",
  event_starts_on: "2026-11-01",
  event_ends_on: "2026-11-30",
  registration_deadline: null,
  status: "published",
  ...overrides,
});

function context(rows: ReturnType<typeof record>[], timezone = "America/Mexico_City") {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {
    select(...args: unknown[]) {
      calls.push(["select", ...args]);
      return this;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", ...args]);
      return this;
    },
    lte(...args: unknown[]) {
      calls.push(["lte", ...args]);
      return this;
    },
    gte(...args: unknown[]) {
      calls.push(["gte", ...args]);
      return this;
    },
    or(...args: unknown[]) {
      calls.push(["or", ...args]);
      return this;
    },
    order(...args: unknown[]) {
      calls.push(["order", ...args]);
      return this;
    },
    limit(...args: unknown[]) {
      calls.push(["limit", ...args]);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    calls,
    value: {
      studio: {
        id: "studio-sandbox",
        name: "Demeter Fitness Studio",
        timezone,
        currency: "MXN",
      },
      supabase: {
        from: (table: string) => {
          calls.push(["from", table]);
          return builder;
        },
      } as never,
    },
  };
}

describe("Demi temporary information runtime UAT checks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("TEMP-01 returns the published workshop through the event end, inclusive", async () => {
    vi.setSystemTime(new Date("2026-11-30T18:00:00-06:00"));
    const ctx = context([record()]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "horario del taller de aro",
    });

    expect(result).toMatchObject({
      ok: true,
      checked_on_local: "2026-11-30",
      items: [{ title: "Taller de aro aéreo", answer_until_on: "2026-11-30" }],
    });
    expect(ctx.calls).toContainEqual(["eq", "studio_id", "studio-sandbox"]);
    expect(ctx.calls).toContainEqual(["eq", "status", "published"]);
    expect(ctx.calls).toContainEqual(["lte", "promotion_starts_on", "2026-11-30"]);
    expect(ctx.calls).toContainEqual(["gte", "event_ends_on", "2026-11-30"]);
  });

  it("TEMP-02 ends answers on the registration deadline, inclusive", async () => {
    vi.setSystemTime(new Date("2026-11-10T12:00:00-06:00"));
    const ctx = context([record({ registration_deadline: "2026-11-10" })]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "taller de aro",
    });

    expect(result).toMatchObject({
      ok: true,
      checked_on_local: "2026-11-10",
      items: [{ answer_until_on: "2026-11-10" }],
    });
    expect(ctx.calls).toContainEqual([
      "or",
      "registration_deadline.is.null,registration_deadline.gte.2026-11-10",
    ]);
  });

  it("TEMP-03 returns the saved workshop schedule verbatim", async () => {
    vi.setSystemTime(new Date("2026-11-05T12:00:00-06:00"));
    const ctx = context([record({ details: "Domingos de 9:00 a 10:30; sede Tonalá." })]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "horario de aro",
    });

    expect(result).toMatchObject({
      items: [{ details: "Domingos de 9:00 a 10:30; sede Tonalá." }],
    });
  });

  it("TEMP-04 excludes a published item before its announcement date", async () => {
    vi.setSystemTime(new Date("2026-09-30T12:00:00-06:00"));
    const ctx = context([record()]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "taller de aro",
    });

    expect(result).toMatchObject({ ok: true, checked_on_local: "2026-09-30", items: [] });
  });

  it("TEMP-05 excludes expired, draft, and archived records while keeping history untouched", async () => {
    vi.setSystemTime(new Date("2026-12-01T12:00:00-06:00"));
    const ctx = context([
      record(),
      record({ id: "draft", status: "draft" }),
      record({ id: "archived", status: "archived" }),
    ]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "taller de aro",
    });

    expect(result).toMatchObject({ ok: true, items: [] });
    expect(ctx.calls).toContainEqual(["eq", "studio_id", "studio-sandbox"]);
  });

  it("TEMP-06 calls the shared assistant read-tool dispatcher", async () => {
    vi.setSystemTime(new Date("2026-11-05T12:00:00-06:00"));
    const ctx = context([record()]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "aro",
    });

    expect(result).toMatchObject({ ok: true, items: [{ title: "Taller de aro aéreo" }] });
    expect(ctx.calls[0]).toEqual(["from", "demi_temporary_information"]);
  });

  it("TEMP-07 returns only the configured facts when a detail was not provided", async () => {
    vi.setSystemTime(new Date("2026-11-05T12:00:00-06:00"));
    const ctx = context([record({ details: "Domingos de 9:00 a 10:30." })]);
    const result = await executeAssistantReadTool(ctx.value, "get_temporary_information", {
      topic: "precio del taller de aro",
    });

    expect(result).toMatchObject({ items: [{ details: "Domingos de 9:00 a 10:30." }] });
    expect(JSON.stringify(result)).not.toContain("$500");
  });

  it("TEMP-08 evaluates deadline boundaries using the studio's local date", async () => {
    vi.setSystemTime(new Date("2026-11-11T05:59:00.000Z"));
    const beforeLocalMidnight = context([record({ registration_deadline: "2026-11-10" })]);
    const before = await executeAssistantReadTool(
      beforeLocalMidnight.value,
      "get_temporary_information",
      { topic: "taller de aro" },
    );

    vi.setSystemTime(new Date("2026-11-11T06:00:00.000Z"));
    const afterLocalMidnight = context([record({ registration_deadline: "2026-11-10" })]);
    const after = await executeAssistantReadTool(
      afterLocalMidnight.value,
      "get_temporary_information",
      { topic: "taller de aro" },
    );

    expect(before).toMatchObject({
      checked_on_local: "2026-11-10",
      items: [{ title: "Taller de aro aéreo" }],
    });
    expect(after).toMatchObject({ checked_on_local: "2026-11-11", items: [] });
  });
});
