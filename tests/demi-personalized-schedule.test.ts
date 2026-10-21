import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { searchClassAvailability } from "../lib/assistant/read-tools";

function catalog() {
  const sessions = [
    ["past", "fitness", "2026-10-21T14:30:00Z"],
    ["early", "fitness", "2026-10-21T23:00:00Z"],
    ["evening", "fitness", "2026-10-22T00:30:00Z"],
    ["tomorrow", "fitness", "2026-10-23T00:30:00Z"],
    ["exotic", "exotic", "2026-10-23T01:30:00Z"],
  ].map(([id, template_id, starts_at]) => ({
    id,
    template_id,
    starts_at,
    ends_at: new Date(Date.parse(starts_at) + 3600000).toISOString(),
    capacity: 5,
    status: "scheduled",
  }));
  const data: Record<string, unknown[]> = {
    class_sessions: sessions,
    class_templates: [
      { id: "fitness", name: "Pole Fitness", discipline_id: "pole", active: true, credit_cost: 1 },
      { id: "exotic", name: "Pole Exotic", discipline_id: "pole", active: true, credit_cost: 1 },
    ],
    disciplines: [{ id: "pole", name: "Pole" }],
    reservations: [],
  };
  const db = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        lt: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve),
      };
      return chain;
    },
  };
  return {
    supabase: db as never,
    studio: { id: "isolated", name: "UAT", timezone: "America/Mexico_City", currency: "MXN" },
  };
}

const args = {
  activity_query: "Pole Fitness",
  date_from: "2026-10-21",
  date_to: "2026-10-23",
  after_time: null,
  before_time: null,
  limit: 20,
};
afterEach(() => vi.useRealTimers());

describe("Demi personalized schedule", () => {
  it("removes past classes and respects the student's local minimum time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z"));
    const result = await searchClassAvailability(catalog(), {
      ...args,
      date_to: "2026-10-21",
      after_time: "18:00",
    });
    expect(result.matches?.map((x) => x.session_ref)).toEqual(["session:evening"]);
    expect(result.searched_range?.after_time).toBe("18:00");
  });

  it("paginates a full requested period without repeating the first options", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z"));
    const first = await searchClassAvailability(catalog(), { ...args, limit: 2, offset: 0 });
    const rest = await searchClassAvailability(catalog(), {
      ...args,
      limit: 2,
      offset: first.next_offset!,
    });
    expect(first.matches?.map((x) => x.session_ref)).toEqual(["session:early", "session:evening"]);
    expect(first.has_more).toBe(true);
    expect(rest.matches?.map((x) => x.session_ref)).toEqual(["session:tomorrow"]);
    expect(rest.has_more).toBe(false);
    expect(rest.next_offset).toBeNull();
  });

  it("resolves speech variants against actual activities without mixing an exact choice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z"));
    const paul = await searchClassAvailability(catalog(), { ...args, activity_query: "Paul" });
    expect(new Set(paul.matches?.map((x) => x.activity))).toEqual(
      new Set(["Pole Fitness", "Pole Exotic"]),
    );
    const exotic = await searchClassAvailability(catalog(), {
      ...args,
      activity_query: "Exotic Pole",
    });
    expect(exotic.matches?.map((x) => x.activity)).toEqual(["Pole Exotic"]);
    const fitness = await searchClassAvailability(catalog(), args);
    expect(fitness.matches?.every((x) => x.activity === "Pole Fitness")).toBe(true);
  });

  it("returns an explicitly empty range rather than inventing an activity", async () => {
    const result = await searchClassAvailability(catalog(), {
      ...args,
      activity_query: "Actividad inexistente",
    });
    expect(result.matches).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});
