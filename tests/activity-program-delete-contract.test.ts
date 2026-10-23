import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261023213000_delete_activity_program.sql",
  "utf8",
);
const actions = readFileSync("app/admin/actividades/programas/actions.ts", "utf8");
const programPage = readFileSync("app/admin/actividades/programas/[programId]/page.tsx", "utf8");
const activitiesPage = readFileSync("app/admin/actividades/page.tsx", "utf8");
const agendaPage = readFileSync("app/admin/agenda/page.tsx", "utf8");
const salePage = readFileSync("app/admin/ventas/[saleId]/page.tsx", "utf8");

describe("safe activity program deletion", () => {
  it("cancels generated sessions so the existing reservation cancellation trigger handles reservations", () => {
    expect(migration).toContain("set status = 'cancelled'");
    expect(migration).toContain("class_session_cancel_reservations");
    expect(migration).toContain("r.status::text = 'reserved'");
  });

  it("preserves financial history by blocking deletion when net payments remain", () => {
    expect(migration).toContain("program_has_recorded_payments");
    expect(migration).toContain("public.payments");
    expect(migration).not.toContain("delete from public.payments");
    expect(migration).not.toContain("delete from public.sales");
    expect(migration).not.toContain("delete from public.reservations");
  });

  it("retires products, templates and the program from operational surfaces", () => {
    expect(migration).toContain("update public.class_templates");
    expect(migration).toContain("update public.product_templates");
    expect(migration).toContain("update public.activity_programs");
    expect(migration).toContain("assistant_visible = false");
    expect(activitiesPage).toContain("program.active &&");
    expect(agendaPage).toContain("visibleSessions");
  });

  it("records unreceived-payment corrections without deleting the original payment", () => {
    expect(migration).toContain("private.payment_record_corrections");
    expect(migration).toContain("admin_correct_unreceived_payment");
    expect(migration).toContain("'correction'");
    expect(migration).toContain("el dinero nunca se recibió");
    expect(migration).not.toContain("delete from public.payments");
    expect(salePage).toContain('"Corregida"');
    expect(salePage).toContain('"Corrección"');
  });

  it("voids standalone zero-net program sales after reservations are cancelled", () => {
    expect(migration).toContain("perform public.void_sale");
    expect(migration).toContain("Venta sin ingreso neto");
    expect(migration).toContain("'sales_voided'");
  });

  it("exposes a guarded admin action and confirmation UI", () => {
    expect(actions).toContain('rpc("admin_delete_activity_program"');
    expect(actions).toContain("program_has_recorded_payments");
    expect(programPage).toContain("DeleteProgramForm");
    expect(programPage).toContain('.eq("active", true)');
  });
});
