import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import {
  classifyAutoAccessResponse,
  type AutoAccessResult,
  type ProvisionResponse,
} from "./auto-access-copy";

export { autoAccessMessage, type AutoAccessStatus } from "./auto-access-copy";

/**
 * P360-V2-ACC · Acceso al portal automático al dar de alta.
 *
 * Toda persona creada por el estudio (alumna, prueba o walk-in) recibe su acceso en el mismo
 * momento: se crea la cuenta y se le envía por WhatsApp el enlace para crear su contraseña.
 * El alta nunca falla por el acceso: si algo sale mal, la persona queda creada y su perfil
 * muestra el acceso como pendiente para reintentar.
 */
export async function studentActivationUrl() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  if (!host) return null;
  return new URL("/login/student/activar", `https://${host}`).toString();
}

async function readFunctionErrorCode(error: unknown) {
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!context?.json) return null;
  try {
    const payload = (await context.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

export async function autoProvisionStudentAccess(
  supabase: SupabaseClient,
  studentId: string | null | undefined,
): Promise<AutoAccessResult> {
  if (!studentId) return { status: "failed", errorCode: "student_missing" };
  try {
    const activationUrl = await studentActivationUrl();
    if (!activationUrl) return { status: "failed", errorCode: "activation_url_unavailable" };

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { status: "failed", errorCode: "session_unavailable" };

    const { data, error } = await supabase.functions.invoke("provision-student-access", {
      body: { studentId, activationUrl },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const errorCode = error ? await readFunctionErrorCode(error) : null;
    return classifyAutoAccessResponse(error ? null : (data as ProvisionResponse), errorCode);
  } catch {
    return { status: "failed", errorCode: "provision_unavailable" };
  }
}
