import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BOOKING_WINDOW_DEFAULTS,
  bookingWindowCopy,
  bookingWindowValuesFromRow,
  describeBookingOpen,
  parseBookingWindowForm,
  sessionBookingState,
} from "../lib/booking-windows";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("NEB-01-38/39/40 reglas de reserva", () => {
  it("los valores de arranque son los de Demeter hoy", () => {
    expect(BOOKING_WINDOW_DEFAULTS).toMatchObject({
      cancellationCutoffMinutes: 300,
      bookingCloseMinutesBefore: 30,
      bookingOpenMode: "none",
      checkinOpensMinutesBefore: 20,
      checkinClosesMinutesAfter: 30,
    });
  });

  it("lee el formulario del estudio y valida rangos", () => {
    const ok = parseBookingWindowForm(
      form({
        booking_open_mode: "weekly",
        booking_open_weekday: "0",
        booking_open_time: "20:00",
        booking_close_minutes: "60",
        checkin_opens_minutes: "15",
        checkin_closes_minutes: "45",
      }),
      "studio",
    );
    expect(ok).toEqual({
      ok: true,
      values: expect.objectContaining({
        bookingOpenMode: "weekly",
        bookingOpenWeekday: 0,
        bookingOpenTime: "20:00",
        bookingCloseMinutesBefore: 60,
        checkinOpensMinutesBefore: 15,
      }),
    });
    const relative = parseBookingWindowForm(
      form({
        booking_open_mode: "relative",
        booking_open_amount: "7",
        booking_open_unit: "days",
        booking_close_minutes: "30",
        checkin_opens_minutes: "20",
        checkin_closes_minutes: "30",
      }),
      "studio",
    );
    expect(relative.ok && relative.values.bookingOpenMinutesBefore).toBe(7 * 1440);
    expect(
      parseBookingWindowForm(
        form({ booking_open_mode: "none", booking_close_minutes: "", checkin_opens_minutes: "1", checkin_closes_minutes: "1" }),
        "studio",
      ),
    ).toEqual({ ok: false, error: "close" });
    expect(
      parseBookingWindowForm(
        form({ booking_open_mode: "relative", booking_open_amount: "0", booking_close_minutes: "30", checkin_opens_minutes: "1", checkin_closes_minutes: "1" }),
        "studio",
      ),
    ).toEqual({ ok: false, error: "open" });
    expect(
      parseBookingWindowForm(
        form({ booking_open_mode: "none", booking_close_minutes: "30", checkin_opens_minutes: "500", checkin_closes_minutes: "1" }),
        "studio",
      ),
    ).toEqual({ ok: false, error: "checkin" });
  });

  it("en una actividad, vacío significa «como el estudio»", () => {
    const parsed = parseBookingWindowForm(form({ cancellation_cutoff_hours: "12" }), "activity");
    expect(parsed).toEqual({
      ok: true,
      values: {
        cancellationCutoffMinutes: 720,
        bookingCloseMinutesBefore: null,
        bookingOpenMode: null,
        bookingOpenMinutesBefore: null,
        bookingOpenWeekday: null,
        bookingOpenTime: null,
        checkinOpensMinutesBefore: null,
        checkinClosesMinutesAfter: null,
      },
    });
  });

  it("describe la apertura y avisa a la alumna", () => {
    expect(describeBookingOpen(BOOKING_WINDOW_DEFAULTS)).toBe("Sin límite");
    expect(
      describeBookingOpen({ ...BOOKING_WINDOW_DEFAULTS, bookingOpenMode: "relative", bookingOpenMinutesBefore: 2880 }),
    ).toBe("2 días antes de la clase");
    expect(
      describeBookingOpen({ ...BOOKING_WINDOW_DEFAULTS, bookingOpenMode: "weekly", bookingOpenWeekday: 0, bookingOpenTime: "20:00" }),
    ).toContain("Domingo 20:00");
    expect(bookingWindowCopy("booking_closed", null, "America/Mexico_City")).toBe("Reservas cerradas");
    expect(bookingWindowCopy("booking_not_open", "2026-11-09T02:00:00Z", "America/Mexico_City")).toMatch(/^Abre /);
    expect(bookingWindowCopy("no_credits", null, "America/Mexico_City")).toBeNull();
    expect(bookingWindowValuesFromRow({ booking_open_time: "20:00:00", booking_open_mode: "weekly" })).toMatchObject({
      bookingOpenTime: "20:00",
      bookingOpenMode: "weekly",
    });
  });

  it("Demi respeta la ventana y sin migración conserva los 30 minutos", () => {
    const now = Date.parse("2026-11-10T18:00:00Z");
    const session = { status: "scheduled", starts_at: "2026-11-10T18:20:00Z" };
    expect(sessionBookingState(session, null, now)).toBe("closed");
    expect(sessionBookingState({ ...session, starts_at: "2026-11-10T19:00:00Z" }, null, now)).toBe("open");
    expect(
      sessionBookingState(session, { opensAt: null, closesAt: "2026-11-10T18:20:00Z", cancellationCutoffMinutes: 300 }, now),
    ).toBe("open");
    expect(
      sessionBookingState(
        { ...session, starts_at: "2026-11-20T18:00:00Z" },
        { opensAt: "2026-11-16T02:00:00Z", closesAt: "2026-11-20T17:30:00Z", cancellationCutoffMinutes: 300 },
        now,
      ),
    ).toBe("not_open");
  });

  it("la base aplica la regla en el insert y en las funciones con tiempos fijos", () => {
    const migration = read("supabase/migrations/20261022217000_neb01_booking_windows.sql");
    expect(migration).toContain("before insert on public.reservations");
    expect(migration).toContain("private.reservation_cancellation_outcome_for_session(\\1.id)");
    expect(migration).toContain("private.session_checkin_opens_at(v_session.id)");
    expect(migration).toContain("private.session_checkin_closes_at(v_session.id)");
    expect(migration).toContain("'public.check_in_reservation(text)'");
    expect(migration).toContain("'public.service_prepare_demi_group(uuid,uuid,uuid,integer,integer)'");
    expect(migration).toContain("raise exception 'NEB-01: definición inesperada");
    // El equipo del estudio puede saltar la ventana; la lista de espera no se frena.
    expect(migration).toContain("private.has_capability(p_studio_id, 'schedule.write')");
    expect(migration).toContain("public.class_waitlist_entries w");
  });

  it("Demi ya no tiene los 30 minutos fijos y usa la misma regla en lectura y acciones", () => {
    const block = (file: string) => {
      const source = read(file);
      const start = source.indexOf("// --- NEB-01-40");
      const end = source.indexOf("// --- fin NEB-01-40 ---");
      expect(start, file).toBeGreaterThan(-1);
      return source.slice(start, end);
    };
    const readTools = block("lib/assistant/read-tools.ts");
    expect(readTools).toBe(block("lib/assistant/action-tools.ts"));
    expect(readTools).toContain('rpc("service_session_booking_windows"');
    expect(read("lib/assistant/read-tools.ts")).not.toContain("Date.now() + 30 * 60_000");
    expect(read("lib/assistant/action-tools.ts")).not.toContain("now + 30 * 60_000");
  });
});
