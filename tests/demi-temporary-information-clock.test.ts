import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getTemporaryInformation } from "@/lib/assistant/read-tools";

afterEach(() => vi.useRealTimers());

describe("Demi isolated UAT clock", () => {
  it("uses the supplied UAT instant at both sides of local midnight", async () => {
    const row = {
      id: "uat-clock",
      title: "Taller de aro",
      kind: "workshop",
      discipline: "Aro",
      details: "Domingos 9:00 a 10:30.",
      promotion_starts_on: "2026-10-01",
      event_starts_on: "2026-11-01",
      event_ends_on: "2026-11-30",
      registration_deadline: "2026-11-10",
      status: "published",
    };
    const builder = {
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
      select() {
        return this;
      },
      eq() {
        return this;
      },
      lte() {
        return this;
      },
      gte() {
        return this;
      },
      or() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return Promise.resolve({ data: [row], error: null });
      },
    };
    const context = (temporaryInformationNow?: string) => ({
      supabase: {
        from: (table: string) =>
          table === "activity_programs"
            ? { ...builder, order: () => Promise.resolve({ data: [], error: null }) }
            : builder,
      } as never,
      studio: {
        id: "uat-studio",
        name: "UAT",
        timezone: "America/Mexico_City",
        currency: "MXN",
        temporaryInformationNow,
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
    const before = await getTemporaryInformation(context("2026-11-11T05:59:00.000Z"), {
      topic: "aro",
    });
    const after = await getTemporaryInformation(context("2026-11-11T06:00:00.000Z"), {
      topic: "aro",
    });
    const realClock = await getTemporaryInformation(context(), { topic: "aro" });

    expect(before).toMatchObject({
      checked_on_local: "2026-11-10",
      items: [{ title: "Taller de aro" }],
    });
    expect(after).toMatchObject({ checked_on_local: "2026-11-11", items: [] });
    expect(realClock).toMatchObject({ checked_on_local: "2026-12-01", items: [] });
  });
});
