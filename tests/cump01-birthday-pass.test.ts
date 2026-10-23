import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  birthdayBookingErrorCopy,
  birthdayPassDaysLeft,
  birthdayPassFitsSession,
  normalizeBirthdayFriendPhone,
  type BirthdayPassSnapshot,
} from "@/lib/birthday/pass";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261023101000_birthday_gift_v1.sql"),
  "utf8",
);

const pass: BirthdayPassSnapshot = {
  eligible: true,
  state: "available",
  period_start: "2026-10-01",
  expires_on: "2026-10-31",
  today: "2026-10-23",
  friend_enabled: true,
};
const session = { status: "scheduled", starts_at: "2026-10-24T15:00:00Z", spots_available: 3 };

describe("CUMP-01 · pase de cumpleaños", () => {
  it("cuenta los días que quedan incluyendo hoy", () => {
    expect(birthdayPassDaysLeft("2026-10-23", "2026-10-31")).toBe(9);
    expect(birthdayPassDaysLeft("2026-10-31", "2026-10-31")).toBe(1);
    expect(birthdayPassDaysLeft(null, "2026-10-31")).toBeNull();
  });

  it("solo se ofrece en clases de su mes, programadas, con cupo y sin lugar a elegir", () => {
    expect(birthdayPassFitsSession(pass, session, "2026-10-24")).toBe(true);
    expect(birthdayPassFitsSession(pass, session, "2026-11-01")).toBe(false);
    expect(birthdayPassFitsSession(pass, { ...session, spots_available: 0 }, "2026-10-24")).toBe(false);
    expect(birthdayPassFitsSession(pass, { ...session, requires_resource: true }, "2026-10-24")).toBe(
      false,
    );
    expect(birthdayPassFitsSession(pass, { ...session, status: "cancelled" }, "2026-10-24")).toBe(false);
    expect(birthdayPassFitsSession({ ...pass, state: "used" }, session, "2026-10-24")).toBe(false);
    expect(birthdayPassFitsSession(null, session, "2026-10-24")).toBe(false);
  });

  it("normaliza el WhatsApp de la amiga", () => {
    expect(normalizeBirthdayFriendPhone("55 2222 2222")).toBe("+525522222222");
    expect(normalizeBirthdayFriendPhone("+52 55 2222 2222")).toBe("+525522222222");
    expect(normalizeBirthdayFriendPhone("12345")).toBeNull();
    expect(normalizeBirthdayFriendPhone("")).toBeNull();
  });

  it("traduce los motivos de rechazo a español", () => {
    expect(birthdayBookingErrorCopy("friend_phone_invalid")).toContain("10 dígitos");
    expect(birthdayBookingErrorCopy("birthday_pass_already_used")).toContain("ya fue utilizado");
    expect(birthdayBookingErrorCopy("algo_raro")).toContain("No pudimos usar tu pase");
    expect(birthdayBookingErrorCopy(null)).toBeNull();
  });

  it("corrige la validación del WhatsApp y respeta los interruptores del estudio", () => {
    expect(migration).toContain("v_phone !~ '^\\+[1-9][0-9]{7,14}$'");
    expect(migration).not.toContain("'^\\\\+[1-9]");
    expect(migration).toContain("birthday_gift_disabled");
    expect(migration).toContain("birthday_friend_disabled");
    expect(migration).toContain("friend_is_self");
  });

  it("devuelve el pase al cancelar a tiempo o si el estudio cancela", () => {
    expect(migration).toContain("new.status in ('cancelled_on_time', 'cancelled_by_studio')");
    expect(migration).toContain("status not in ('cancelled_on_time', 'cancelled_by_studio')");
  });

  it("instala el aviso del día 1 apagado y solo por WhatsApp", () => {
    expect(migration).toContain("'marketing.birthday_month', 'student.birthday_month_due', false");
    expect(migration).toContain("'birthday_month', 259200");
    expect(migration).toContain("revoke all on function public.system_birthday_month_notification_eligible");
    expect(migration).toContain("to service_role");
  });

  it("protege las lecturas y cambios del equipo", () => {
    expect(migration).toContain("private.has_capability(p_studio_id, 'settings.write')");
    expect(migration).toContain("private.has_capability(v_student.studio_id, 'students.read')");
    expect(migration).toContain(
      "revoke all on function public.admin_update_birthday_settings(uuid, boolean, boolean) from public, anon",
    );
  });
});
