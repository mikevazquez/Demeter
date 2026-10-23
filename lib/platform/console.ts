import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StudioEntitlements } from "@/lib/platform/entitlements";
import { parseEntitlements } from "@/lib/platform/entitlements";
import { supportAuditLabel } from "@/lib/platform/support";
import type { PlatformModuleKey, PlatformPlanKey, StudioSubscriptionStatus } from "./catalog";

// NEB-01-10/11/12 · Lecturas de la consola de Nébora (migración 20261023155000).
// Si la migración no está aplicada, las lecturas regresan null y la consola lo dice.

export type PlatformOverview = {
  studiosTotal: number;
  studiosByStatus: Partial<Record<StudioSubscriptionStatus, number>>;
  mrrMxn: number;
  foundingUsed: number;
  foundingSeats: number;
  studiosActiveStudents: number;
  pendingRequests: number;
};

export type PlatformStudioRow = {
  id: string;
  name: string;
  brandName: string;
  slug: string | null;
  plan: PlatformPlanKey;
  planLabel: string;
  status: StudioSubscriptionStatus;
  monthlyPriceMxn: number;
  foundingMonth: number | null;
  cutDay: number | null;
  nextCutOn: string | null;
  studentsActive: number;
  pendingRequests: number;
};

export type PlatformPendingRequest = { module: PlatformModuleKey; requestedAt: string };
export type PlatformAuditEntry = {
  occurredAt: string;
  action: string;
  detail: Record<string, unknown>;
};

export type PlatformStudioDetail = {
  studio: { id: string; name: string; brandName: string; slug: string | null };
  entitlements: StudioEntitlements | null;
  nextCutOn: string | null;
  statusChangedAt: string | null;
  graceStartedAt: string | null;
  students: { total: number; active: number; newThisMonth: number };
  studentsWithPackage: number;
  classes: { thisWeek: number; thisMonth: number };
  reservationsMonth: { booked: number; attended: number; cancelled: number };
  salesMonth: { count: number; totalMinor: number };
  demiMonth: { calls: number; inputTokens: number; outputTokens: number; costUsdMicros: number };
  ownerLastSignInAt: string | null;
  pendingRequests: PlatformPendingRequest[];
  audit: PlatformAuditEntry[];
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseOverview(raw: unknown): PlatformOverview | null {
  if (!raw || typeof raw !== "object") return null;
  const data = obj(raw);
  const byStatus = obj(data.studios_by_status);
  return {
    studiosTotal: num(data.studios_total),
    studiosByStatus: Object.fromEntries(
      Object.entries(byStatus).map(([key, value]) => [key, num(value)]),
    ),
    mrrMxn: num(data.mrr_mxn),
    foundingUsed: num(data.founding_used),
    foundingSeats: num(data.founding_seats),
    studiosActiveStudents: num(data.students_active),
    pendingRequests: num(data.pending_requests),
  };
}

export function parseStudioRows(raw: unknown): PlatformStudioRow[] {
  return list(raw).map((item) => {
    const row = obj(item);
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      brandName: String(row.brand_name ?? row.name ?? ""),
      slug: str(row.slug),
      plan: String(row.plan ?? "core") as PlatformPlanKey,
      planLabel: String(row.plan_label ?? ""),
      status: String(row.status ?? "active") as StudioSubscriptionStatus,
      monthlyPriceMxn: num(row.monthly_price_mxn),
      foundingMonth: row.founding_month == null ? null : num(row.founding_month),
      cutDay: row.cut_day == null ? null : num(row.cut_day),
      nextCutOn: str(row.next_cut_on),
      studentsActive: num(row.students_active),
      pendingRequests: num(row.pending_requests),
    };
  });
}

export function parseStudioDetail(raw: unknown): PlatformStudioDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const data = obj(raw);
  const studio = obj(data.studio);
  const students = obj(data.students);
  const classes = obj(data.classes);
  const reservations = obj(data.reservations_month);
  const sales = obj(data.sales_month);
  const demi = obj(data.demi_month);
  return {
    studio: {
      id: String(studio.id ?? ""),
      name: String(studio.name ?? ""),
      brandName: String(studio.brand_name ?? studio.name ?? ""),
      slug: str(studio.slug),
    },
    entitlements:
      data.entitlements && typeof data.entitlements === "object"
        ? parseEntitlements(data.entitlements as Parameters<typeof parseEntitlements>[0])
        : null,
    nextCutOn: str(data.next_cut_on),
    statusChangedAt: str(data.status_changed_at),
    graceStartedAt: str(data.grace_started_at),
    students: {
      total: num(students.total),
      active: num(students.active),
      newThisMonth: num(students.new_this_month),
    },
    studentsWithPackage: num(data.students_with_package),
    classes: { thisWeek: num(classes.this_week), thisMonth: num(classes.this_month) },
    reservationsMonth: {
      booked: num(reservations.booked),
      attended: num(reservations.attended),
      cancelled: num(reservations.cancelled),
    },
    salesMonth: { count: num(sales.count), totalMinor: num(sales.total_minor) },
    demiMonth: {
      calls: num(demi.calls),
      inputTokens: num(demi.input_tokens),
      outputTokens: num(demi.output_tokens),
      costUsdMicros: num(demi.cost_usd_micros),
    },
    ownerLastSignInAt: str(data.owner_last_sign_in_at),
    pendingRequests: list(data.pending_requests).map((item) => {
      const entry = obj(item);
      return {
        module: String(entry.module ?? "") as PlatformModuleKey,
        requestedAt: String(entry.requested_at ?? ""),
      };
    }),
    audit: list(data.audit).map((item) => {
      const entry = obj(item);
      return {
        occurredAt: String(entry.occurred_at ?? ""),
        action: String(entry.action ?? ""),
        detail: obj(entry.detail),
      };
    }),
  };
}

export async function loadPlatformOverview(
  supabase: SupabaseClient,
): Promise<PlatformOverview | null> {
  const { data, error } = await supabase.rpc("platform_overview");
  return error ? null : parseOverview(data);
}

export async function loadPlatformStudios(
  supabase: SupabaseClient,
): Promise<PlatformStudioRow[] | null> {
  const { data, error } = await supabase.rpc("platform_list_studios");
  return error ? null : parseStudioRows(data);
}

export async function loadPlatformStudioDetail(
  supabase: SupabaseClient,
  studioId: string,
): Promise<PlatformStudioDetail | null> {
  const { data, error } = await supabase.rpc("platform_studio_detail", { p_studio: studioId });
  return error ? null : parseStudioDetail(data);
}

/** Texto en español para cada acción de la bitácora. */
export function auditActionLabel(entry: PlatformAuditEntry): string {
  const detail = entry.detail;
  const support = supportAuditLabel(entry.action, detail);
  if (support) return support;
  switch (entry.action) {
    case "studio.plan.set":
      return `Plan: ${String(detail.from ?? "—")} → ${String(detail.to ?? "—")}`;
    case "studio.module.on":
      return `Módulo activado: ${String(detail.module ?? "")}`;
    case "studio.module.off":
      return `Módulo desactivado: ${String(detail.module ?? "")}`;
    case "studio.status.set":
      return `Estado: ${String(detail.from ?? "—")} → ${String(detail.to ?? "—")}`;
    case "studio.module.requested":
      return `El estudio pidió: ${String(detail.module ?? "")}`;
    default:
      return entry.action;
  }
}

export const STATUS_LABEL: Record<StudioSubscriptionStatus, string> = {
  invited: "Invitado",
  active: "Activo",
  grace: "En gracia",
  read_only: "Solo lectura",
  suspended: "Suspendido",
  internal: "Interno",
};

/** Costo de Demi en USD (micros → dólares con 2 decimales). */
export function formatUsdMicros(micros: number): string {
  return `US$${(micros / 1_000_000).toFixed(2)}`;
}

export function formatMinorMxn(minor: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export function formatDateMx(value: string | null): string {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(date);
}
