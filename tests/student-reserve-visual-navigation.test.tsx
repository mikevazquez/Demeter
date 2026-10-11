import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StudentSession } from "@/lib/student/portal";
import type { StudentHolidaySnapshot } from "@/app/student/reservar/HolidayNotice";

const fixture = vi.hoisted(() => ({
  sessions: [] as StudentSession[],
  holiday: null as StudentHolidaySnapshot | null,
  waitlistedIds: [] as string[],
  rpc: vi.fn(),
}));

vi.mock("@/lib/student/portal", () => ({
  localDateKey: () => "2026-10-12",
  formatDateTime: () => "Lunes 12 de octubre, 5:00 p.m.",
  formatMoney: (minor: number) => (minor / 100).toFixed(2),
  bookingReasonCopyForStudent: (reason: string) => `Restricción: ${reason}`,
  getStudentPortalContext: async () => ({
    studio: { timezone: "America/Mexico_City" },
    membership: { studio_id: "sandbox-test" },
    snapshot: { acquisitions: [] },
    supabase: {
      rpc: fixture.rpc,
      from: (table: string) => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: { color_hex: "#D52473" } };
        },
        async in() {
          return {
            data:
              table === "class_sessions"
                ? fixture.sessions.map((s) => ({ id: s.session_id, requires_resource: false }))
                : fixture.sessions.map((s) => ({
                    name: s.activity,
                    color_hex: "#D52473",
                    drop_in_price_minor: 15000,
                  })),
          };
        },
      }),
    },
  }),
}));

vi.mock("@/app/student/actions", () => ({
  bookStudentSessionInlineAction: vi.fn(),
  joinStudentWaitlistInlineAction: vi.fn(),
  createSingleClassMercadoPagoOrderAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/image", () => ({
  // Static visual fixtures serve local assets without the Next image endpoint.
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) =>
    createElement("img", { ...props, alt: props.alt ?? "" }),
}));
vi.mock("@/app/student/reservar/BookingRestrictionCard", () => ({
  BookingRestrictionCard: () => null,
}));

import StudentReservePage from "@/app/student/reservar/page";
import StudentSessionDetailPage from "@/app/student/reservar/[sessionId]/page";

function session(overrides: Partial<StudentSession> = {}): StudentSession {
  return {
    session_id: "class-1",
    status: "scheduled",
    starts_at: "2026-10-12T23:00:00Z",
    ends_at: "2026-10-13T00:00:00Z",
    capacity: 10,
    spots_available: 8,
    activity: "Exotic Pole",
    discipline_id: "pole",
    discipline: "Pole Fitness",
    credit_cost: 1,
    drop_in_price_minor: 15000,
    space: "Salón principal",
    location: null,
    coach: "Valentina",
    description: null,
    requires_resource: false,
    is_reserved: false,
    eligibility: { eligible: true, reason_code: null },
    ...overrides,
  };
}

async function render(credit?: string) {
  return renderToStaticMarkup(
    await StudentReservePage({ searchParams: Promise.resolve({ date: "2026-10-12", credit }) }),
  );
}

function saveVisualFixture(name: string, html: string) {
  const directory = process.env.TASK_PORTAL_VISUAL_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.html`), html);
}

beforeEach(() => {
  fixture.sessions = [session()];
  fixture.holiday = null;
  fixture.waitlistedIds = [];
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "student_session_detail"
        ? fixture.sessions[0]
        : name === "student_schedule_feed"
          ? fixture.sessions
          : name === "student_holiday_snapshot"
            ? fixture.holiday
            : name === "student_holiday_week_snapshot"
              ? fixture.holiday
                ? [fixture.holiday]
                : []
              : name === "student_waitlist_feed"
                ? fixture.waitlistedIds.map((id) => ({ session_id: id, status: "active" }))
                : name === "student_reward_status_snapshot"
                  ? {}
                  : [],
    error: null,
  }));
});

describe("approved student agenda navigation", () => {
  it("preserves quick booking for eligible classes", async () => {
    const html = await render();
    expect(html).toMatch(/<button[^>]*>Reservar<\/button>/);
    expect(html).toContain('src="/disciplinas/exotic.jpg"');
  });

  it.each(["no_active_product", "no_credits", "outside_product", "outside_product_schedule"])(
    "opens existing checkout detail for %s, preserving date and reward context",
    async (reason) => {
      fixture.sessions = [session({ eligibility: { eligible: false, reason_code: reason } })];
      const html = await render("reward");
      expect(html).toContain('href="/student/reservar/class-1?date=2026-10-12&amp;credit=reward"');
      expect(html).toContain(`aria-label="Pagar Exotic Pole: Restricción: ${reason}"`);
      expect(html).toMatch(/<a[^>]*>Pagar<\/a>/);
      expect(html).not.toContain("Ver paquetes");
      expect(html).not.toMatch(/<button/);
    },
  );

  it("routes full and already waitlisted classes to detail without joining from the agenda", async () => {
    fixture.sessions = [
      session({
        spots_available: 0,
        eligibility: { eligible: false, reason_code: "session_full" },
      }),
    ];
    expect(await render()).toMatch(/<a[^>]*>Espera<\/a>/);
    fixture.waitlistedIds = ["class-1"];
    const html = await render();
    expect(html).toMatch(/<a[^>]*>Ver lista<\/a>/);
    expect(html).toContain("En espera");
    expect(html).not.toContain("Unirme a lista de espera");
  });

  it("keeps waitlisted status when a spot is available", async () => {
    fixture.waitlistedIds = ["class-1"];
    const html = await render();
    expect(html).toMatch(/<a[^>]*>Ver lista<\/a>/);
    expect(html).not.toMatch(/<button/);
  });

  it("preserves reserved and cancelled states without booking actions", async () => {
    fixture.sessions = [session({ is_reserved: true })];
    const reserved = await render();
    expect(reserved).toContain("Reservada");
    expect(reserved).toMatch(/<a[^>]*>Ver<\/a>/);
    fixture.sessions = [session({ status: "cancelled" })];
    const cancelled = await render();
    expect(cancelled).toContain("Cancelada por el estudio");
    expect(cancelled).not.toMatch(/<button/);
    expect(cancelled.match(/<article.*?<\/article>/)?.[0].match(/<a\s/g)).toHaveLength(1);
  });

  it("keeps document restrictions out of the payment route", async () => {
    fixture.sessions = [
      session({ eligibility: { eligible: false, reason_code: "document_required" } }),
    ];
    const html = await render();
    expect(html).toMatch(/<a[^>]*>Ver<\/a>/);
    expect(html).not.toMatch(/<a[^>]*>Pagar<\/a>/);
  });

  it.each(["closed", "special"] as const)(
    "keeps holiday %s behavior without next-open-day navigation",
    async (mode) => {
      fixture.holiday = {
        holiday_id: "holiday-1",
        holiday_code: "test",
        holiday_date: "2026-10-12",
        name: "Festivo de prueba",
        theme_key: "labor_day",
        is_official: true,
        operation_mode: mode,
        message: "Consulta nuestra agenda.",
        configured: true,
        source_label: "Prueba",
        source_url: null,
        legal_basis: null,
      };
      const html = await render();
      expect(html).toContain("⚒");
      expect(html).toContain(`data-holiday-operation="${mode}"`);
      if (mode === "closed") {
        expect(html).toContain("text-decoration:line-through");
        expect(html).not.toContain("data-density");
      } else {
        expect(html).not.toContain("text-decoration:line-through");
        expect(html).toContain('data-density="compact"');
      }
      expect(html).not.toContain("Reservar para el");
      expect(fixture.rpc).toHaveBeenCalledWith("student_holiday_week_snapshot", {
        target_start: "2026-10-12",
        target_end: "2026-10-18",
      });
      saveVisualFixture(`holiday-${mode}`, html);
    },
  );

  it("renders the full state matrix for mobile review", async () => {
    fixture.sessions = [
      session(),
      session({ session_id: "class-2", activity: "Twerk", spots_available: 2 }),
      session({
        session_id: "class-3",
        activity: "Heels",
        eligibility: { eligible: false, reason_code: "no_credits" },
      }),
      session({ session_id: "class-4", activity: "Telas", is_reserved: true }),
      session({
        session_id: "class-5",
        activity: "Aro Aéreo",
        spots_available: 0,
        eligibility: { eligible: false, reason_code: "session_full" },
      }),
      session({
        session_id: "class-6",
        activity: "Yoga",
        spots_available: 0,
        eligibility: { eligible: false, reason_code: "session_full" },
      }),
      session({ session_id: "class-7", activity: "Flexibilidad", status: "cancelled" }),
      session({
        session_id: "class-8",
        activity: "Actividad de nombre muy largo",
        discipline: "Otra disciplina",
        eligibility: { eligible: false, reason_code: "document_required" },
      }),
    ];
    fixture.waitlistedIds = ["class-6"];
    const html = await render();
    expect(html.match(/data-density="compact"/g)).toHaveLength(8);
    saveVisualFixture("agenda-states", html);
  });
});

describe("existing detail actions after agenda navigation", () => {
  async function detail() {
    return renderToStaticMarkup(
      await StudentSessionDetailPage({
        params: Promise.resolve({ sessionId: "class-1" }),
        searchParams: Promise.resolve({ date: "2026-10-12" }),
      }),
    );
  }

  it("retains the purchase button and package destination in class detail", async () => {
    fixture.sessions = [session({ eligibility: { eligible: false, reason_code: "no_credits" } })];
    const html = await detail();
    expect(html).toContain('href="/student/paquete"');
    expect(html).toContain("Clase suelta: 150.00 MXN");
    expect(html).toMatch(/<button[^>]*>Comprar · 150<\/button>/);
    saveVisualFixture("detail-payment", html);
  });

  it("retains waitlist entry and existing waitlist status in class detail", async () => {
    fixture.sessions = [
      session({
        spots_available: 0,
        eligibility: { eligible: false, reason_code: "session_full" },
      }),
    ];
    expect(await detail()).toContain("Unirme a lista de espera");
    fixture.waitlistedIds = ["class-1"];
    expect(await detail()).toContain("En lista de espera");
  });

  it("renders the discipline image with a long title in the class header", async () => {
    fixture.sessions = [
      session({ activity: "Exotic Pole · Técnica y secuencias para todos los niveles" }),
    ];
    const html = await detail();
    expect(html).toContain('width="84"');
    expect(html).toContain('src="/disciplinas/exotic.jpg"');
    saveVisualFixture("detail-long-title", html);
  });
});
