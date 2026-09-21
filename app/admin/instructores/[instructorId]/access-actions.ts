"use server";

import { FunctionsHttpError } from "@supabase/supabase-js";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

export type ProvisionInstructorAccessResult =
  | {
      ok: true;
      email: string;
      temporaryPassword: string;
      mustChangePassword: true;
    }
  | { ok: false; error: string };

async function readFunctionError(error: unknown) {
  if (!(error instanceof FunctionsHttpError)) return null;

  try {
    const payload = (await error.context.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

async function invokeInstructorAccess(
  instructorId: string,
  mode: "provision" | "reset",
): Promise<ProvisionInstructorAccessResult> {
  if (!instructorId) return { ok: false, error: "invalid_request" };

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: instructor, error: instructorError } = await supabase
    .from("instructors")
    .select("id, person_id, status")
    .eq("id", instructorId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (instructorError || !instructor) return { ok: false, error: "instructor_not_found" };
  if (instructor.status !== "active") return { ok: false, error: "instructor_not_active" };

  const { data: membership, error: membershipError } = await supabase
    .from("studio_memberships")
    .select("user_id, active")
    .eq("studio_id", studio.id)
    .eq("person_id", instructor.person_id)
    .eq("role", "instructor")
    .maybeSingle();

  if (membershipError) return { ok: false, error: "access_lookup_failed" };
  if (mode === "provision" && membership?.user_id) {
    return { ok: false, error: "instructor_already_linked" };
  }
  if (mode === "reset" && !membership?.user_id) {
    return { ok: false, error: "instructor_access_missing" };
  }

  if (mode === "reset" && membership?.user_id) {
    const { data: account, error: accountError } = await supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", membership.user_id)
      .maybeSingle();

    if (accountError || !account || account.status !== "active" || membership.active !== true) {
      return { ok: false, error: "instructor_access_inconsistent" };
    }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) return { ok: false, error: "provision_unavailable" };

  const { data, error } = await supabase.functions.invoke("provision-instructor-access", {
    body: mode === "reset" ? { instructorId, mode: "reset" } : { instructorId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const functionError = error ? await readFunctionError(error) : null;
  if (error || !data || data.ok !== true) {
    return {
      ok: false,
      error:
        functionError ?? (typeof data?.error === "string" ? data.error : "provision_unavailable"),
    };
  }

  return {
    ok: true,
    email: String(data.email),
    temporaryPassword: String(data.temporaryPassword),
    mustChangePassword: true,
  };
}

export async function provisionInstructorAccess(instructorId: string) {
  return invokeInstructorAccess(instructorId, "provision");
}

export async function resetInstructorTemporaryPassword(instructorId: string) {
  return invokeInstructorAccess(instructorId, "reset");
}
