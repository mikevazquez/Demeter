import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// NEB-01-17 · Modo soporte de la consola (migración 20261023161000_neb01_support_sessions).
// Si la migración no está aplicada, las lecturas regresan null y la consola no muestra el modo.

export type SupportState =
  | { active: false }
  | { active: true; sessionId: string; reason: string; startedAt: string; expiresAt: string };

export type SupportPackage = {
  id: string;
  name: string;
  productType: string;
  priceMinor: number;
  creditLimit: number | null;
  validityDays: number | null;
  unlimited: boolean;
  active: boolean;
  onlinePurchasable: boolean;
};

export type SupportScheduleItem = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  className: string;
  capacity: number;
  reserved: number;
};

export type SupportDiagnostics = {
  classesNext7Days: number;
  reservationsNext7Days: number;
  classesWithoutReservations7Days: number;
  salesWithDueDate: number;
  productsActive: number;
  productsInactive: number;
};

export type StudioSupportAccess = {
  active: { reason: string; startedAt: string; expiresAt: string } | null;
  recent: Array<{ reason: string; startedAt: string; endedAt: string; changes: number }>;
};

type Raw = Record<string, unknown>;
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const str = (value: unknown) => (typeof value === "string" ? value : "");

export function parseSupportState(raw: unknown): SupportState | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Raw;
  if (data.active !== true) return { active: false };
  return {
    active: true,
    sessionId: str(data.session_id),
    reason: str(data.reason),
    startedAt: str(data.started_at),
    expiresAt: str(data.expires_at),
  };
}

export function parseSupportPackages(raw: unknown): SupportPackage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Raw) => ({
    id: str(item.id),
    name: str(item.name),
    productType: str(item.product_type),
    priceMinor: num(item.price_minor),
    creditLimit: item.credit_limit == null ? null : num(item.credit_limit),
    validityDays: item.validity_days == null ? null : num(item.validity_days),
    unlimited: item.unlimited === true,
    active: item.active === true,
    onlinePurchasable: item.online_purchasable === true,
  }));
}

export function parseSupportSchedule(raw: unknown): SupportScheduleItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Raw) => ({
    id: str(item.id),
    startsAt: str(item.starts_at),
    endsAt: item.ends_at ? str(item.ends_at) : null,
    status: str(item.status),
    className: str(item.class_name) || "Clase",
    capacity: num(item.capacity),
    reserved: num(item.reserved),
  }));
}

export function parseSupportDiagnostics(raw: unknown): SupportDiagnostics | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Raw;
  return {
    classesNext7Days: num(data.classes_next_7_days),
    reservationsNext7Days: num(data.reservations_next_7_days),
    classesWithoutReservations7Days: num(data.classes_without_reservations_7_days),
    salesWithDueDate: num(data.sales_with_due_date),
    productsActive: num(data.products_active),
    productsInactive: num(data.products_inactive),
  };
}

export function parseStudioSupportAccess(raw: unknown): StudioSupportAccess | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Raw;
  const active =
    data.active && typeof data.active === "object"
      ? {
          reason: str((data.active as Raw).reason),
          startedAt: str((data.active as Raw).started_at),
          expiresAt: str((data.active as Raw).expires_at),
        }
      : null;
  const recent = Array.isArray(data.recent)
    ? data.recent.map((item: Raw) => ({
        reason: str(item.reason),
        startedAt: str(item.started_at),
        endedAt: str(item.ended_at),
        changes: num(item.changes),
      }))
    : [];
  return { active, recent };
}

export async function loadSupportState(supabase: SupabaseClient, studioId: string) {
  const { data, error } = await supabase.rpc("platform_support_state", { p_studio: studioId });
  return error ? null : parseSupportState(data);
}

/** Lee una pestaña de soporte; cada lectura queda en la bitácora del estudio. */
export async function loadSupportTab(
  supabase: SupabaseClient,
  studioId: string,
  tab: "diagnostico" | "paquetes" | "horario",
) {
  if (tab === "paquetes") {
    const { data, error } = await supabase.rpc("platform_support_packages", { p_studio: studioId });
    return error ? null : { tab, packages: parseSupportPackages(data) };
  }
  if (tab === "horario") {
    const { data, error } = await supabase.rpc("platform_support_schedule", {
      p_studio: studioId,
      p_days: 14,
    });
    return error ? null : { tab, schedule: parseSupportSchedule(data) };
  }
  const { data, error } = await supabase.rpc("platform_support_diagnostics", { p_studio: studioId });
  return error ? null : { tab, diagnostics: parseSupportDiagnostics(data) };
}

/** Pesos a centavos para el precio editable ("1,250.50" → 125050). */
export function parsePriceMxnToMinor(value: string): number | null {
  const clean = value.replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

const SUPPORT_TAB_LABEL: Record<string, string> = {
  diagnostico: "Diagnóstico",
  paquetes: "Paquetes",
  horario: "Horario",
};

/** Texto de la bitácora para las acciones de soporte (las demás las resuelve console.ts). */
export function supportAuditLabel(action: string, detail: Record<string, unknown>): string | null {
  switch (action) {
    case "support.session.start":
      return `Soporte entró al estudio · ${String(detail.reason ?? "")}`;
    case "support.session.end":
      return "Soporte salió del estudio";
    case "support.session.expired":
      return "Sesión de soporte terminada por tiempo";
    case "support.read":
      return `Soporte consultó ${SUPPORT_TAB_LABEL[String(detail.tab ?? "")] ?? String(detail.tab ?? "")}`;
    case "support.package.update": {
      const before = (detail.before ?? {}) as Record<string, unknown>;
      const after = (detail.after ?? {}) as Record<string, unknown>;
      const changes: string[] = [];
      if (before.name !== after.name) changes.push(`nombre «${String(after.name)}»`);
      if (before.price_minor !== after.price_minor)
        changes.push(
          `precio $${(num(before.price_minor) / 100).toFixed(2)} → $${(num(after.price_minor) / 100).toFixed(2)}`,
        );
      if (before.active !== after.active) changes.push(after.active ? "activado" : "desactivado");
      return `Soporte cambió paquete: ${changes.join(", ") || "sin cambios"}`;
    }
    default:
      return null;
  }
}
