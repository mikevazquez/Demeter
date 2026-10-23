import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261023167000_neb01_booking_pause_notice.sql");

describe("NEB-01-43 aviso al pausar reservas", () => {
  it("emite el evento al crear la pausa y la regla arranca apagada", () => {
    expect(migration).toContain("after insert on public.student_booking_penalties");
    expect(migration).toContain("'student.booking_paused'");
    expect(migration).toContain("'operations.booking_paused', 'student.booking_paused', false, 1");
  });

  it("avisa por bandeja y push con fecha y motivo, sin WhatsApp", () => {
    expect(migration).toContain("'inbox', true, 1");
    expect(migration).toContain("'push', false, 0");
    expect(migration).toContain("{{kind_label}}");
    expect(migration).toContain("{{ends_on}}");
    expect(migration).not.toContain("'whatsapp'");
  });
});
