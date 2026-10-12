"use server";

import { revalidatePath } from "next/cache";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export type PoleActionResult = { ok: true; count?: number } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP_LEVELS = new Set(["principiante", "intermedio", "avanzado"]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function errorCode(error: { message?: string } | null) {
  const message = error?.message ?? "";
  const match = message.match(/(pole_[a-z_]+|evaluation_access_denied)/);
  return match?.[1] ?? "pole_action_failed";
}

async function requireWriter() {
  const context = await getAdminContext();
  if (!context.can(CAPABILITIES.EVALUATIONS_WRITE)) return null;
  return context;
}

export async function savePolePlanAction(input: {
  sessionId: string;
  level: string;
  elementIds: string[];
  newElementId: string | null;
  studentIds: string[];
}): Promise<PoleActionResult> {
  const context = await requireWriter();
  if (!context) return { ok: false, error: "evaluation_access_denied" };
  if (
    !isUuid(input.sessionId) ||
    !GROUP_LEVELS.has(input.level) ||
    !input.elementIds.length ||
    !input.elementIds.every(isUuid) ||
    (input.newElementId !== null && !isUuid(input.newElementId)) ||
    !input.studentIds.every(isUuid)
  ) {
    return { ok: false, error: "pole_invalid_input" };
  }

  const { error } = await context.supabase.rpc("staff_save_pole_plan", {
    p_class_session_id: input.sessionId,
    p_catalog_level: input.level,
    p_element_ids: input.elementIds,
    p_new_element_id: input.newElementId,
    p_student_ids: input.studentIds,
  });
  if (error) return { ok: false, error: errorCode(error) };

  revalidatePath(`/admin/agenda/${input.sessionId}`);
  return { ok: true };
}

export async function validatePoleFiguresAction(input: {
  sessionId: string;
  items: { studentId: string; elementId: string }[];
}): Promise<PoleActionResult> {
  const context = await requireWriter();
  if (!context) return { ok: false, error: "evaluation_access_denied" };
  if (
    !isUuid(input.sessionId) ||
    !input.items.length ||
    !input.items.every((item) => isUuid(item.studentId) && isUuid(item.elementId))
  ) {
    return { ok: false, error: "pole_invalid_input" };
  }

  const { data, error } = await context.supabase.rpc("staff_validate_pole_figures", {
    p_class_session_id: input.sessionId,
    p_items: input.items.map((item) => ({
      student_id: item.studentId,
      element_id: item.elementId,
    })),
  });
  if (error) return { ok: false, error: errorCode(error) };

  revalidatePath(`/admin/agenda/${input.sessionId}`);
  return { ok: true, count: typeof data === "number" ? data : input.items.length };
}

export async function setPoleAuthorizationAction(input: {
  sessionId: string | null;
  studentId: string;
  elementId: string;
  authorized: boolean;
}): Promise<PoleActionResult> {
  const context = await requireWriter();
  if (!context) return { ok: false, error: "evaluation_access_denied" };
  if (!isUuid(input.studentId) || !isUuid(input.elementId)) {
    return { ok: false, error: "pole_invalid_input" };
  }

  const { error } = await context.supabase.rpc("staff_set_pole_authorization", {
    p_student_id: input.studentId,
    p_element_id: input.elementId,
    p_authorized: input.authorized,
  });
  if (error) return { ok: false, error: errorCode(error) };

  if (input.sessionId && isUuid(input.sessionId)) {
    revalidatePath(`/admin/agenda/${input.sessionId}`);
  }
  revalidatePath(`/admin/alumnas/${input.studentId}`);
  return { ok: true };
}
