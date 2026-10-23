import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parsePriceMxnToMinor,
  parseStudioSupportAccess,
  parseSupportState,
  supportAuditLabel,
} from "@/lib/platform/support";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261023161000_neb01_support_sessions.sql");

describe("NEB-01-17 modo soporte", () => {
  it("todas las funciones públicas son solo para usuarios con sesión, nunca anon", () => {
    for (const fn of [
      "platform_start_support_session(uuid, text)",
      "platform_end_support_session(uuid)",
      "platform_support_state(uuid)",
      "platform_support_diagnostics(uuid)",
      "platform_support_packages(uuid)",
      "platform_support_update_package(uuid, uuid, text, integer, boolean)",
      "platform_support_schedule(uuid, integer)",
      "studio_support_access(uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(migration).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    expect(migration).toContain(
      "revoke all on table public.platform_support_sessions from anon, authenticated;",
    );
  });

  it("las pestañas exigen sesión de soporte y cada lectura queda en bitácora", () => {
    for (const tab of ["diagnostico", "paquetes", "horario"]) {
      expect(migration).toContain(`private.platform_require_support(p_studio, '${tab}')`);
    }
    expect(migration).toContain("raise exception 'support_session_required'");
    expect(migration).toContain("'support.read'");
    expect(migration).toContain("'support.package.update'");
    expect(migration).toContain("interval '2 hours'");
  });

  it("lee el estado y el aviso de la dueña", () => {
    expect(parseSupportState({ active: false })).toEqual({ active: false });
    expect(
      parseSupportState({
        active: true,
        session_id: "s",
        reason: "Precios",
        started_at: "a",
        expires_at: "b",
      }),
    ).toEqual({ active: true, sessionId: "s", reason: "Precios", startedAt: "a", expiresAt: "b" });
    expect(parseSupportState(null)).toBeNull();
    const access = parseStudioSupportAccess({
      active: { reason: "Precios", started_at: "a", expires_at: "b" },
      recent: [{ reason: "Precios", started_at: "a", ended_at: "b", changes: 2 }],
    });
    expect(access?.active?.reason).toBe("Precios");
    expect(access?.recent[0].changes).toBe(2);
  });

  it("convierte el precio a centavos y rechaza textos raros", () => {
    expect(parsePriceMxnToMinor("1,250.50")).toBe(125050);
    expect(parsePriceMxnToMinor("$900")).toBe(90000);
    expect(parsePriceMxnToMinor("-5")).toBeNull();
    expect(parsePriceMxnToMinor("abc")).toBeNull();
  });

  it("explica la bitácora en español", () => {
    expect(supportAuditLabel("support.session.start", { reason: "Precios" })).toBe(
      "Soporte entró al estudio · Precios",
    );
    expect(supportAuditLabel("support.read", { tab: "horario" })).toBe("Soporte consultó Horario");
    expect(
      supportAuditLabel("support.package.update", {
        before: { name: "A", price_minor: 100000, active: true },
        after: { name: "A", price_minor: 120000, active: false },
      }),
    ).toBe("Soporte cambió paquete: precio $1000.00 → $1200.00, desactivado");
    expect(supportAuditLabel("studio.plan.set", {})).toBeNull();
  });
});
