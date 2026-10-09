import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntelligencePage from "@/app/admin/inteligencia/page";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const context = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: context.get }));
vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => createElement("a", props),
}));

type Row = Record<string, unknown>;
type Call = { table: string; method: string; args: unknown[] };
const NOW = new Date("2026-10-09T18:00:00Z");
const current = "2026-10-08T18:00:00Z";
const previous = "2026-08-20T18:00:00Z";
let tables: Record<string, Row[]>;
let calls: Call[];

function seed(table: string, rows: Row[]) {
  tables[table] = rows.map((row) => ({
    studio_id: "studio-test",
    ...(table === "sales" ? { currency: "MXN", folio: "TEST-001" } : {}),
    ...row,
  }));
}

// A small PostgREST double applies the requested filters rather than returning
// every fixture unconditionally. Tenant and period predicates can therefore fail.
function from(table: string) {
  let rows = tables[table] ?? [];
  let range: [number, number] | null = null;
  const query = {
    select(...args: unknown[]) {
      calls.push({ table, method: "select", args });
      return query;
    },
    eq(key: string, value: unknown) {
      calls.push({ table, method: "eq", args: [key, value] });
      rows = rows.filter((row) => row[key] === value);
      return query;
    },
    neq(key: string, value: unknown) {
      rows = rows.filter((row) => row[key] !== value);
      return query;
    },
    is(key: string, value: unknown) {
      rows = rows.filter((row) => row[key] === value);
      return query;
    },
    in(key: string, values: unknown[]) {
      calls.push({ table, method: "in", args: [key, values] });
      rows = rows.filter((row) => values.includes(row[key]));
      return query;
    },
    gte(key: string, value: string) {
      rows = rows.filter((row) => String(row[key]) >= value);
      return query;
    },
    lt(key: string, value: string) {
      rows = rows.filter((row) => String(row[key]) < value);
      return query;
    },
    order(key: string, options?: { ascending?: boolean }) {
      rows = [...rows].sort(
        (a, b) =>
          String(a[key]).localeCompare(String(b[key])) * (options?.ascending === false ? -1 : 1),
      );
      return query;
    },
    range(from: number, to: number) {
      range = [from, to];
      return query;
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve({
        data: range ? rows.slice(range[0], range[1] + 1) : rows,
        error: null,
      }).then(resolve);
    },
  };
  calls.push({ table, method: "from", args: [] });
  return query;
}

async function render(view = "resumen", days = "30") {
  const page = await IntelligencePage({ searchParams: Promise.resolve({ view, days }) });
  return renderToStaticMarkup(page);
}

function metric(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<span>${escaped}</span><strong>(.*?)</strong>`));
  expect(match, `Missing metric ${label}`).not.toBeNull();
  return match![1];
}

function student(id: string, extra: Row = {}): Row {
  return { id, full_name: id, active: true, created_at: current, trial_status: null, ...extra };
}

function acquisition(id: string, extra: Row = {}): Row {
  return {
    id,
    student_id: "Ana",
    product_template_id: "package",
    status: "active",
    starts_on: "2026-09-01",
    expires_on: "2026-11-01",
    created_at: current,
    refunded_at: null,
    ...extra,
  };
}

function session(extra: Row = {}): Row {
  return {
    id: "session",
    template_id: "pole",
    starts_at: current,
    capacity: 10,
    status: "completed",
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  tables = {};
  calls = [];
  context.get.mockResolvedValue({
    supabase: { from },
    studio: {
      id: "studio-test",
      locale: "en-US",
      currency: "MXN",
      timezone: "America/Mexico_City",
    },
  });
  seed("product_templates", [
    { id: "package", product_type: "package", name: "Paquete" },
    { id: "membership", product_type: "membership", name: "Membresía" },
    { id: "single", product_type: "single_class", name: "Clase" },
    { id: "enrollment", product_type: "enrollment", name: "Inscripción" },
  ]);
  seed("class_templates", [{ id: "pole", name: "Pole", color_hex: "#FF0A8A" }]);
});
afterEach(() => vi.useRealTimers());

describe("Inteligencia V2 runtime", () => {
  it.each(["resumen", "dinero", "alumnas", "conversion", "clases", "asistencia"])(
    "requires reports.read for %s",
    async (view) => {
      await render(view);
      expect(context.get).toHaveBeenCalledWith(CAPABILITIES.REPORTS_READ);
    },
  );

  it.each(["resumen", "dinero", "alumnas", "conversion", "clases", "asistencia"])(
    "scopes all direct table reads to the studio in %s",
    async (view) => {
      await render(view);
      for (const table of new Set(calls.filter((c) => c.method === "from").map((c) => c.table))) {
        expect(calls).toContainEqual({ table, method: "eq", args: ["studio_id", "studio-test"] });
      }
    },
  );

  it.each(["resumen", "dinero", "alumnas", "conversion", "clases", "asistencia"])(
    "renders finite empty metrics for %s",
    async (view) => {
      const html = await render(view);
      expect(html).toContain("intel-page");
      expect(html).not.toMatch(/NaN|Infinity/);
      expect(html).toContain("intel-metric");
    },
  );

  it("propagates an authorization failure", async () => {
    context.get.mockRejectedValueOnce(new Error("forbidden"));
    await expect(render()).rejects.toThrow("forbidden");
    expect(calls).toEqual([]);
  });

  it.each(["unknown", "marketing", "", "constructor"])(
    "falls back to summary for view %j",
    async (view) => {
      expect(await render(view)).toContain("Requiere atención");
    },
  );

  it.each(["resumen", "dinero", "alumnas", "conversion", "clases", "asistencia"])(
    "shows the same six navigation destinations in %s",
    async (view) => {
      const html = await render(view);
      for (const target of ["resumen", "dinero", "alumnas", "conversion", "clases", "asistencia"]) {
        expect(html).toContain(`view=${target}&amp;days=30`);
      }
      expect(html).not.toContain("view=marketing");
    },
  );

  it.each(["0", "-7", "abc", "999", "", "NaN"])(
    "normalizes unsupported period %j to 30 days",
    async (days) => {
      expect(await render("resumen", days)).toContain("view=dinero&amp;days=30");
    },
  );

  it.each(["7", "30", "90"])("retains supported period %s", async (days) => {
    expect(await render("resumen", days)).toContain(`view=dinero&amp;days=${days}`);
  });

  it.each([
    ["attended", 1, 1, 0, "0%"],
    ["converted", 1, 1, 1, "100%"],
    ["no_show", 1, 0, 0, "0%"],
    ["pending", 1, 0, 0, "0%"],
    ["cancelled", 1, 0, 0, "0%"],
    [null, 0, 0, 0, "0%"],
  ])(
    "counts trial status %s consistently",
    async (status, registered, attended, converted, rate) => {
      seed("students", [student("Ana", { trial_status: status })]);
      const html = await render("conversion");
      expect(metric(html, "Pruebas registradas")).toBe(String(registered));
      expect(metric(html, "Asistieron")).toBe(String(attended));
      expect(metric(html, "Se convirtieron")).toBe(String(converted));
      expect(metric(html, "Conversión")).toBe(rate);
    },
  );

  it.each([previous, "2026-10-10T18:00:00Z", "2026-10-09T18:00:00Z"])(
    "excludes trial created outside the current half-open period: %s",
    async (created_at) => {
      seed("students", [student("Ana", { created_at, trial_status: "converted" })]);
      expect(metric(await render("conversion"), "Se convirtieron")).toBe("0");
    },
  );

  it("includes trials exactly at the current period start", async () => {
    seed("students", [
      student("Ana", { created_at: "2026-09-09T18:00:00Z", trial_status: "converted" }),
    ]);
    expect(metric(await render("conversion"), "Se convirtieron")).toBe("1");
  });

  it("calculates conversion from attendees rather than all registered trials", async () => {
    seed("students", [
      student("A", { trial_status: "converted" }),
      student("B", { trial_status: "attended" }),
      student("C", { trial_status: "no_show" }),
    ]);
    const html = await render("conversion");
    expect(metric(html, "Conversión")).toBe("50%");
    expect(html).toContain("1 personas asistieron pero todavía no aparecen como convertidas.");
    expect(html).toContain("1 clases de prueba terminaron en no show");
  });

  it("reads real conversations and explains unmeasured qualification", async () => {
    const html = await render("conversion");
    expect(html).toContain("No hay conversaciones registradas");
    expect(html).toContain("no cuentan todavía con un evento medible");
    expect(calls.some((c) => c.table === "crm_conversations")).toBe(true);
  });

  it.each([
    ["reserved", "0%", "0", "0%", "0%"],
    ["attended", "10%", "1", "0%", "0%"],
    ["no_show", "0%", "0", "0%", "100%"],
    ["cancelled_on_time", "0%", "0", "100%", "0%"],
    ["cancelled_late", "0%", "0", "100%", "0%"],
    ["cancelled_by_studio", "0%", "0", "0%", "0%"],
    ["waitlisted", "0%", "0", "0%", "0%"],
  ])(
    "preserves historical class counts for %s",
    async (status, occupancy, attended, cancellations, noShow) => {
      seed("class_sessions", [session()]);
      seed("reservations", [{ id: "r", session_id: "session", status }]);
      const html = await render("clases");
      expect(metric(html, "Ocupación")).toBe(occupancy);
      expect(metric(html, "Asistencias")).toBe(attended);
      expect(metric(html, "Cancelaciones")).toBe(cancellations);
      expect(metric(html, "No show")).toBe(noShow);
    },
  );

  it.each(["cancelled", "scheduled", "completed"])("handles session state %s", async (status) => {
    seed("class_sessions", [session({ status })]);
    seed("reservations", [{ id: "r", session_id: "session", status: "attended" }]);
    expect(metric(await render("clases"), "Asistencias")).toBe(status === "cancelled" ? "0" : "1");
  });

  it("does not read another studio's reservations through unscoped session IDs", async () => {
    seed("class_sessions", [session(), session({ id: "other", studio_id: "other-studio" })]);
    seed("reservations", [{ id: "r", session_id: "other", status: "attended" }]);
    expect(metric(await render("clases"), "Asistencias")).toBe("0");
    expect(calls).toContainEqual({
      table: "reservations",
      method: "in",
      args: ["session_id", ["session"]],
    });
  });

  it("uses total seats rather than averaging unequal session percentages", async () => {
    seed("class_sessions", [session({ capacity: 2 }), session({ id: "second", capacity: 8 })]);
    seed(
      "reservations",
      ["1", "2"].map((id) => ({ id, session_id: "session", status: "attended" })),
    );
    expect(metric(await render("clases"), "Ocupación")).toBe("20%");
  });

  it.each([0, null])("returns zero occupancy with capacity %s", async (capacity) => {
    seed("class_sessions", [session({ capacity })]);
    seed("reservations", [{ id: "r", session_id: "session", status: "attended" }]);
    expect(metric(await render("clases"), "Ocupación")).toBe("0%");
  });

  it.each(["package", "membership", "single", "enrollment"])(
    "counts active commercial coverage from %s",
    async (product_template_id) => {
      seed("students", [student("Ana")]);
      seed("product_acquisitions", [acquisition("a", { product_template_id })]);
      expect(metric(await render("alumnas"), "Activas")).toBe(
        product_template_id === "enrollment" ? "0" : "1",
      );
    },
  );

  it.each([
    [{ status: "cancelled" }, "0"],
    [{ refunded_at: current }, "0"],
    [{ starts_on: "2026-10-10" }, "0"],
    [{ expires_on: "2026-10-08" }, "0"],
    [{ expires_on: "2026-10-09" }, "1"],
    [{ expires_on: null }, "1"],
  ])("handles commercial coverage boundary %j", async (extra, expected) => {
    seed("product_acquisitions", [acquisition("a", extra)]);
    expect(metric(await render("alumnas"), "Activas")).toBe(expected);
  });

  it("deduplicates active people with multiple commercial products", async () => {
    seed("product_acquisitions", [acquisition("a"), acquisition("b")]);
    expect(metric(await render("alumnas"), "Activas")).toBe("1");
  });

  it.each([
    [6, "0", "0", null],
    [7, "1", "0", "En riesgo"],
    [14, "1", "0", "En riesgo"],
    [15, "0", "0", "Inactiva"],
    [29, "0", "0", "Inactiva"],
    [30, "0", "1", "Abandono"],
    [31, "0", "1", "Abandono"],
  ])("classifies expiration age %s days", async (days, risk, abandoned, state) => {
    const expires_on = new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
    seed("students", [student("Ana")]);
    seed("product_acquisitions", [acquisition("a", { expires_on })]);
    const html = await render("alumnas");
    expect(metric(html, "En riesgo")).toBe(risk);
    expect(metric(html, "Abandono")).toBe(abandoned);
    if (state) expect(html).toContain(`<b>${state}</b>`);
    else expect(html).not.toContain('class="intel-risk-row"');
  });

  it("removes old expiration risk when a later valid package exists", async () => {
    seed("students", [student("Ana")]);
    seed("product_acquisitions", [
      acquisition("old", { expires_on: "2026-09-01" }),
      acquisition("new"),
    ]);
    const html = await render("alumnas");
    expect(metric(html, "Abandono")).toBe("0");
    expect(metric(html, "Activas")).toBe("1");
  });

  it.each(["payment", "refund"])("applies the sign of %s to cash received", async (kind) => {
    seed("payments", [{ sale_id: "sale", kind, amount_minor: 15000, created_at: current }]);
    expect(metric(await render("dinero"), "Ingresos cobrados")).toBe(
      kind === "refund" ? "-MX$150" : "MX$150",
    );
  });

  it("subtracts refunds without calling net cash profit", async () => {
    seed("payments", [
      { kind: "payment", amount_minor: 20000, created_at: current },
      { kind: "refund", amount_minor: 5000, created_at: current },
    ]);
    const html = await render("dinero");
    expect(metric(html, "Ingresos cobrados")).toBe("MX$150");
    expect(metric(html, "Reembolsos")).toBe("MX$50");
    expect(html).not.toMatch(/utilidad|margen operativo/i);
  });

  it.each(["confirmed", "cancelled", "draft"])(
    "uses only confirmed sales for average ticket: %s",
    async (status) => {
      seed("sales", [{ id: "sale", status, total_minor: 15000, created_at: current }]);
      expect(metric(await render("dinero"), "Ticket promedio")).toBe(
        status === "confirmed" ? "MX$150" : "MX$0",
      );
    },
  );

  it.each([0, 5000, 10000, 15000])(
    "floors outstanding balance with payment %s",
    async (amount_minor) => {
      seed("sales", [{ id: "sale", status: "confirmed", total_minor: 10000, created_at: current }]);
      seed("payments", [{ sale_id: "sale", kind: "payment", amount_minor, created_at: current }]);
      const expected = amount_minor === 0 ? "MX$100" : amount_minor === 5000 ? "MX$50" : "MX$0";
      expect(metric(await render("dinero"), "Pendiente de cobro")).toBe(expected);
    },
  );

  it("ignores refunded sale lines when calculating outstanding balance", async () => {
    seed("sales", [{ id: "sale", status: "confirmed", total_minor: 20000, created_at: current }]);
    seed("sale_lines", [
      { sale_id: "sale", line_total_minor: 10000, refunded_at: null, created_at: current },
      { sale_id: "sale", line_total_minor: 10000, refunded_at: current, created_at: current },
    ]);
    expect(metric(await render("dinero"), "Pendiente de cobro")).toBe("MX$100");
  });

  it.each([previous, "2026-10-10T18:00:00Z", "2026-10-09T18:00:00Z"])(
    "excludes payment outside current period: %s",
    async (created_at) => {
      seed("payments", [{ kind: "payment", amount_minor: 15000, created_at }]);
      expect(metric(await render("dinero"), "Ingresos cobrados")).toBe("MX$0");
    },
  );

  it.each([
    "documents_completed_at",
    "profile_completed_at",
    "first_reservation_at",
    "first_attendance_at",
    "app_installed_at",
    "notifications_enabled_at",
  ])("renders recorded onboarding evidence for %s", async (step) => {
    seed("students", [student("Ana")]);
    seed("reward_onboarding", [{ student_id: "Ana", [step]: current, completed_at: null }]);
    const html = await render("alumnas");
    expect(html).toContain("1/6 pasos completados");
    expect(html).toContain('href="/admin/alumnas/Ana"');
    expect(html).toContain("1/1");
  });

  it("excludes unrelated onboarding records", async () => {
    seed("students", [student("Ana")]);
    seed("reward_onboarding", [{ student_id: "other", completed_at: current }]);
    expect(await render("alumnas")).toContain("No hay onboarding pendiente.");
  });

  it("shows completed onboarding without putting it in pending follow-up", async () => {
    seed("students", [student("Ana")]);
    seed("reward_onboarding", [{ student_id: "Ana", completed_at: current }]);
    const html = await render("alumnas");
    expect(html).toContain("No hay onboarding pendiente.");
    expect(html).toContain("Onboarding completo");
    expect(html).toContain("1/1");
  });
});

describe("Inteligencia metrics reference", () => {
  it("counts actual attendance rather than bookings as occupancy", async () => {
    seed("class_sessions", [session()]);
    seed(
      "reservations",
      ["attended", "no_show", "reserved", "cancelled_late", "cancelled_on_time"].map(
        (status, i) => ({ id: String(i), session_id: "session", status }),
      ),
    );
    const html = await render("asistencia");
    expect(metric(html, "Asistencia")).toBe("25%");
    expect(metric(html, "No show")).toBe("33.3%");
    expect(metric(await render("clases"), "Ocupación")).toBe("10%");
  });
  it("paginates more than 1000 source rows", async () => {
    seed(
      "class_sessions",
      Array.from({ length: 1001 }, (_, i) => session({ id: String(i) })),
    );
    expect(metric(await render("clases"), "Clases impartidas")).toBe("1001");
  });
  it("includes earlier unpaid sales and their earlier payments in outstanding balance", async () => {
    seed("sales", [
      { id: "old", status: "confirmed", total_minor: 10000, created_at: "2026-01-01T00:00:00Z" },
    ]);
    seed("payments", [
      { sale_id: "old", kind: "payment", amount_minor: 2500, created_at: "2026-01-02T00:00:00Z" },
    ]);
    expect(metric(await render("dinero"), "Pendiente de cobro")).toBe("MX$75");
  });
  it("deduplicates conversations and shows conversion by registered origin", async () => {
    seed("students", [student("Ana", { trial_status: "converted" })]);
    seed(
      "crm_conversations",
      [1, 2].map((id) => ({
        id: String(id),
        student_id: "Ana",
        source: "Instagram",
        started_at: current,
      })),
    );
    const html = await render("conversion");
    expect(metric(html, "Prospectos registrados")).toBe("1");
    expect(metric(html, "Contacto → paquete")).toBe("100%");
    expect(html).toContain("Instagram");
  });
  it("retains the last week of the 90-day period", async () => {
    seed("payments", [
      { kind: "payment", method: "cash", amount_minor: 54300, created_at: current },
    ]);
    const html = await render("dinero", "90");
    expect(html).toContain("Oct 3");
    expect(html).toContain("MX$543");
  });
  it("accepts canonical payment and retention aliases", async () => {
    expect(await render("pagos")).toContain("Pagos pendientes");
    expect(await render("retencion")).toContain("Vencen en los próximos 7 días");
  });
  it("filters class metrics by discipline while leaving payments studio-wide", async () => {
    seed("class_templates", [
      { id: "pole", name: "Pole" },
      { id: "flex", name: "Flex" },
    ]);
    seed("class_sessions", [session(), session({ id: "flex", template_id: "flex" })]);
    seed("reservations", [
      { id: "one", session_id: "session", status: "attended" },
      { id: "two", session_id: "flex", status: "attended" },
    ]);
    const html = renderToStaticMarkup(
      await IntelligencePage({
        searchParams: Promise.resolve({ view: "asistencia", discipline: "pole" }),
      }),
    );
    expect(metric(html, "Visitas al estudio")).toBe("1");
    expect(html).toContain("discipline=pole");
  });
});
