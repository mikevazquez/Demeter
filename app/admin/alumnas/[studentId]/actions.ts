"use server";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

const structuralFieldKeys = new Set(["first_name", "last_name", "phone", "email"]);

export type ProvisionStudentAccessResult =
  | {
      ok: true;
      phone: string;
      temporaryPassword: string;
      mustChangePassword: true;
    }
  | { ok: false; error: string };

async function readProvisioningFunctionError(error: unknown) {
  if (!(error instanceof FunctionsHttpError)) return null;

  try {
    const payload = (await error.context.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

async function invokeStudentAccess(
  studentId: string,
  mode: "provision" | "reset",
): Promise<ProvisionStudentAccessResult> {
  if (!studentId) return { ok: false, error: "invalid_request" };

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, user_id, lifecycle_status, active")
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (studentError || !student) return { ok: false, error: "student_not_found" };
  if (!student.active || student.lifecycle_status !== "active") {
    return { ok: false, error: "student_not_active" };
  }

  if (mode === "provision" && student.user_id) {
    return { ok: false, error: "student_already_linked" };
  }

  if (mode === "reset") {
    if (!student.user_id) return { ok: false, error: "student_access_missing" };

    const { data: account, error: accountError } = await supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", student.user_id)
      .maybeSingle();

    if (accountError || !account || account.status !== "active") {
      return { ok: false, error: "student_access_inconsistent" };
    }
    if (account.must_change_password !== true) {
      return { ok: false, error: "temporary_password_reset_closed" };
    }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { ok: false, error: "provision_unavailable" };
  }

  const { data, error } = await supabase.functions.invoke("provision-student-access", {
    body: mode === "reset" ? { studentId, mode: "reset" } : { studentId },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const functionError = error ? await readProvisioningFunctionError(error) : null;

  if (error || !data || data.ok !== true) {
    return {
      ok: false,
      error:
        functionError ?? (typeof data?.error === "string" ? data.error : "provision_unavailable"),
    };
  }

  return {
    ok: true,
    phone: String(data.phone),
    temporaryPassword: String(data.temporaryPassword),
    mustChangePassword: true,
  };
}

async function getAcquisitionEditContext(studentId: string, acquisitionId: string) {
  const ctx = await getAdminContext();
  if (!ctx.can(CAPABILITIES.SALES_WRITE) && !ctx.can(CAPABILITIES.PRODUCTS_WRITE)) {
    redirect(`/admin/alumnas/${studentId}?error=acquisition_forbidden`);
  }

  const { data: acquisition } = await ctx.supabase
    .from("product_acquisitions")
    .select("id")
    .eq("id", acquisitionId)
    .eq("student_id", studentId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!acquisition) redirect(`/admin/alumnas/${studentId}?error=acquisition_not_found`);
  return ctx;
}

function revalidateAcquisitionViews(studentId: string) {
  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/alumnas");
  revalidatePath("/student");
  revalidatePath("/student/paquete");
}

export async function provisionStudentAccess(
  studentId: string,
): Promise<ProvisionStudentAccessResult> {
  return invokeStudentAccess(studentId, "provision");
}

export async function resetStudentTemporaryPassword(
  studentId: string,
): Promise<ProvisionStudentAccessResult> {
  return invokeStudentAccess(studentId, "reset");
}

export async function updateStudent(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email =
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase() || null;
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!studentId || !firstName || !phone) {
    redirect(`/admin/alumnas/${studentId}?error=invalid`);
  }

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { error } = await supabase.rpc("admin_update_student", {
    p_student_id: studentId,
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
    p_email: email,
  });

  if (error) {
    const code = error.message.includes("phone_exists") ? "phone_exists" : "save";
    redirect(`/admin/alumnas/${studentId}?error=${code}`);
  }

  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/alumnas");
  redirect(`/admin/alumnas/${studentId}?saved=1`);
}

export async function updateDynamicProfileFields(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  if (!studentId) redirect("/admin/alumnas?error=profile_fields");

  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data: definitions, error: definitionsError } = await supabase
    .from("profile_field_definitions")
    .select("id, key, field_type")
    .eq("studio_id", studio.id)
    .eq("entity_type", "student")
    .eq("active", true);

  if (definitionsError) redirect(`/admin/alumnas/${studentId}?error=profile_fields`);

  const values: Record<string, unknown> = {};

  for (const definition of definitions ?? []) {
    if (structuralFieldKeys.has(definition.key)) continue;

    const fieldName = `field_${definition.id}`;
    const rawValue = formData.get(fieldName);

    if (definition.field_type === "boolean") {
      values[definition.key] = formData.getAll(fieldName).includes("true");
      continue;
    }

    if (definition.field_type === "multi_select") {
      values[definition.key] = formData
        .getAll(fieldName)
        .map(String)
        .filter((value) => value.trim() !== "");
      continue;
    }

    const textValue = rawValue === null ? "" : String(rawValue).trim();
    if (!textValue) {
      values[definition.key] = null;
      continue;
    }

    if (definition.field_type === "number") {
      const numberValue = Number(textValue);
      if (!Number.isFinite(numberValue)) {
        redirect(`/admin/alumnas/${studentId}?error=profile_fields`);
      }
      values[definition.key] = numberValue;
      continue;
    }

    values[definition.key] = textValue;
  }

  const { error } = await supabase.rpc("admin_set_student_profile_fields", {
    p_student_id: studentId,
    p_values: values,
  });

  if (error) redirect(`/admin/alumnas/${studentId}?error=profile_fields`);

  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/alumnas");
  redirect(`/admin/alumnas/${studentId}?saved=fields`);
}

export async function setStudentLifecycle(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!studentId || !["active", "inactive", "archived"].includes(status)) {
    redirect(`/admin/alumnas/${studentId}?error=lifecycle`);
  }

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_ARCHIVE);
  const { error } = await supabase.rpc("admin_set_student_lifecycle", {
    p_student_id: studentId,
    p_status: status,
  });

  if (error) redirect(`/admin/alumnas/${studentId}?error=lifecycle`);

  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/alumnas");
  redirect(`/admin/alumnas/${studentId}?saved=1`);
}

export async function setAcquisitionStartDate(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const acquisitionId = String(formData.get("acquisition_id") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "").trim();

  if (!studentId || !acquisitionId || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    redirect(`/admin/alumnas/${studentId}?error=acquisition_date_invalid`);
  }

  const { supabase } = await getAcquisitionEditContext(studentId, acquisitionId);
  const { error } = await supabase.rpc("admin_set_acquisition_start_date", {
    target_acquisition_id: acquisitionId,
    target_starts_on: startsOn,
  });

  if (error) {
    redirect(`/admin/alumnas/${studentId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidateAcquisitionViews(studentId);
  redirect(`/admin/alumnas/${studentId}?saved=acquisition_date`);
}

export async function setAcquisitionAvailableCredits(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const acquisitionId = String(formData.get("acquisition_id") ?? "");
  const availableCredits = Number(formData.get("available_credits"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (
    !studentId ||
    !acquisitionId ||
    !Number.isInteger(availableCredits) ||
    availableCredits < 0 ||
    availableCredits > 100000 ||
    !reason
  ) {
    redirect(`/admin/alumnas/${studentId}?error=credits_invalid`);
  }

  const { supabase } = await getAcquisitionEditContext(studentId, acquisitionId);
  const { error } = await supabase.rpc("admin_set_acquisition_available_credits", {
    target_acquisition_id: acquisitionId,
    target_available: availableCredits,
    target_reason: reason,
  });

  if (error) {
    redirect(`/admin/alumnas/${studentId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidateAcquisitionViews(studentId);
  redirect(`/admin/alumnas/${studentId}?saved=credits_adjusted`);
}
