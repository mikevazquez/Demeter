import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { executeAssistantReadTool } from "@/lib/assistant/read-tools";

const studioId = "studio-1";
const product = { studio_id: studioId, active: true, price_minor: 60000, currency: "MXN" };
const dates = [1, 8, 15, 22, 29].map((day) => ({
  studio_id: studioId,
  product: { ...product, price_minor: 15000 },
  session: {
    studio_id: studioId,
    starts_at: `2026-11-${String(day).padStart(2, "0")}T16:30:00Z`,
    ends_at: `2026-11-${String(day).padStart(2, "0")}T18:00:00Z`,
    status: "scheduled",
    assistant_visible: true,
    location: null,
    template: { studio_id: studioId, discipline: { studio_id: studioId, name: "Danza Aérea" } },
  },
}));
const program = {
  id: "existing-program",
  studio_id: studioId,
  name: "Aparatos Aéreos para principiantes",
  kind: "workshop",
  description: "",
  active: true,
  created_at: "2026-10-13T13:26:20Z",
  allow_single: false,
  // Creation keeps this product out of the regular sales catalog.
  product: { ...product, assistant_visible: false },
  dates,
};

function context(programs: unknown[] = [program], now = "2026-10-23T18:00:00Z", failedTable = "") {
  const calls: Array<[string, string, unknown]> = [];
  const tables: Record<string, unknown[]> = {
    activity_programs: programs,
    demi_temporary_information: [],
    assistant_admin_rules: [{ instruction: "Indicaciones oficiales" }],
  };
  const ctx = {
    studio: {
      id: studioId,
      name: "Estudio",
      currency: "MXN",
      timezone: "America/Mexico_City",
      temporaryInformationNow: now,
    },
    supabase: {
      rpc: async () => ({
        data: { ok: true, enabled: false, workshops: [], current_purchase: null },
        error: null,
      }),
      from(table: string) {
        let rows = tables[table] ?? [];
        const result = () => ({
          data: rows,
          error: table === failedTable ? { message: "read failed" } : null,
        });
        const builder = {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            calls.push([table, column, value]);
            if (table === "activity_programs")
              rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
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
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ ...result(), data: rows[0] ?? null });
          },
          then(resolve: (value: ReturnType<typeof result>) => unknown) {
            return Promise.resolve(result()).then(resolve);
          },
        };
        return builder;
      },
    } as never,
  };
  return { ctx, calls };
}

describe("Demi reads existing workshops from Cursos y talleres", () => {
  it("includes earlier registered programs in the current workshop tool even when automatic enrollment is disabled", async () => {
    const { ctx } = context();
    const result = await executeAssistantReadTool(ctx, "get_workshop_options", {});
    expect(result).toMatchObject({
      ok: true,
      enabled: false,
      workshops: [],
      current_purchase: null,
      registered_programs: [
        { title: program.name, price_minor: 60000, demi_purchase_supported: false },
      ],
      availability_is_guaranteed: false,
    });
    expect(result.registered_programs?.[0]).not.toHaveProperty("workshop_ref");
  });

  it("keeps masterclasses registered by the current app searchable", async () => {
    const { ctx } = context([{ ...program, kind: "masterclass" }]);
    expect(
      await executeAssistantReadTool(ctx, "get_temporary_information", { topic: "masterclass" }),
    ).toMatchObject({ items: [{ title: program.name, type: "masterclass" }] });
  });

  it.each(["información de talleres", "Aparatos aéreos para principiantes"])(
    "finds the saved program without a temporary announcement: %s",
    async (topic) => {
      const { ctx, calls } = context();
      const result = await executeAssistantReadTool(ctx, "get_temporary_information", { topic });
      expect(result).toMatchObject({
        ok: true,
        checked_on_local: "2026-10-23",
        items: [
          {
            source: "activity_programs",
            title: "Aparatos Aéreos para principiantes",
            price_minor: 60000,
            currency: "MXN",
            event_starts_on: "2026-11-01",
            event_ends_on: "2026-11-29",
            allow_single: false,
            sessions: dates.map(({ session }) => ({
              starts_at: session.starts_at,
              starts_at_local: "10:30",
              ends_at_local: "12:00",
              single_price_minor: null,
            })),
          },
        ],
      });
      expect(calls).toContainEqual(["activity_programs", "studio_id", studioId]);
      expect(calls).toContainEqual(["activity_programs", "active", true]);
    },
  );

  it("does not expose inactive, expired, cancelled, hidden or other-studio programs and sessions", async () => {
    const programs = [
      { ...program, active: false },
      { ...program, studio_id: "other-studio" },
      { ...program, dates: dates.map((date) => ({ ...date, studio_id: "other-studio" })) },
      ...[{ status: "cancelled" }, { assistant_visible: false }, { studio_id: "other-studio" }].map(
        (overrides) => ({
          ...program,
          dates: dates.map((date) => ({ ...date, session: { ...date.session, ...overrides } })),
        }),
      ),
    ];
    expect(
      await executeAssistantReadTool(context(programs).ctx, "get_temporary_information", {
        topic: "talleres",
      }),
    ).toMatchObject({ ok: true, items: [] });
    expect(
      await executeAssistantReadTool(
        context([program], "2026-11-30T06:00:00Z").ctx,
        "get_temporary_information",
        { topic: "talleres" },
      ),
    ).toMatchObject({ ok: true, items: [] });
  });

  it("uses the local last day inclusively and returns single-date prices only when enabled", async () => {
    const { ctx } = context([{ ...program, allow_single: true }], "2026-11-30T05:59:00Z");
    expect(
      await executeAssistantReadTool(ctx, "get_temporary_information", { topic: "talleres" }),
    ).toMatchObject({
      checked_on_local: "2026-11-29",
      items: [{ sessions: dates.map(() => ({ single_price_minor: 15000 })) }],
    });
  });

  it("does not replace a missing or inactive program price with a regular package price", async () => {
    for (const missingPrice of [
      null,
      { ...product, active: false },
      { ...product, studio_id: "other-studio" },
    ]) {
      const { ctx } = context([{ ...program, product: missingPrice }]);
      expect(
        await executeAssistantReadTool(ctx, "get_temporary_information", { topic: "talleres" }),
      ).toMatchObject({ items: [{ price_minor: null, currency: null }] });
    }
  });

  it.each(["activity_programs", "demi_temporary_information"])(
    "reports a read failure instead of claiming there are no workshops: %s",
    async (table) => {
      const { ctx } = context([program], undefined, table);
      expect(
        await executeAssistantReadTool(ctx, "get_temporary_information", { topic: "talleres" }),
      ).toEqual({ ok: false, error: "temporary_information_unavailable" });
    },
  );
});
