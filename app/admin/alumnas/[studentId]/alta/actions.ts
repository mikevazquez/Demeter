"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function onboardingUrl(studentId: string, error?: string) {
  const base = `/admin/alumnas/${studentId}/alta`;
  return error ? `${base}?error=${encodeURIComponent(error)}` : base;
}

function redirectError(studentId: string, code: string): never {
  redirect(onboardingUrl(studentId, code));
}

function dateOrNull(value: FormDataEntryValue | null) {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function moneyToMinor(value: FormDataEntryValue | null) {
  const raw = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!raw) return 0;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return null;
  return Math.round(amount * 100);
}

function rpcErrorCode(message: string) {
  const known = [
    "package_not_available",
    "product_validity_missing",
    "package_start_mode_invalid",
    "package_start_date_required",
    "discount_invalid",
    "discount_kind_invalid",
    "discount_reason_required",
    "prior_credits_unavailable_for_unlimited",
    "prior_credits_exceed_package",
    "prior_credits_reason_required",
    "prior_credits_exceed_available",
    "enrollment_resolution_required",
    "enrollment_product_not_configured",
    "enrollment_effective_date_required",
    "enrollment_effective_date_future",
    "enrollment_reason_required",
    "enrollment_already_active",
    "enrollment_not_required",
    "enrollment_payment_required",
    "payment_exceeds_balance",
    "payment_method_required",
    "payment_effective_date_required",
    "payment_effective_date_future",
    "payment_followup_required",
    "payment_due_date_past",
    "pending_access_reason_required",
    "student_not_operable",
    "forbidden",
  ];

  return known.find((code) => message.includes(code)) ?? "onboarding_sale_failed";
}

export async function createStudentOnboardingSale(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "").trim();
  const productId = String(formData.get("package_product_id") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim();
  const startMode = String(formData.get("package_start_mode") ?? "").trim();
  const packageStartsOn = dateOrNull(formData.get("package_starts_on"));
  const discountMode = String(formData.get("discount_mode") ?? "none").trim();
  const discountValue = String(formData.get("discount_value") ?? "").trim();
  const discountReason = String(formData.get("discount_reason") ?? "").trim();
  const enrollmentResolution = String(
    formData.get("enrollment_resolution") ?? "not_required",
  ).trim();
  const enrollmentProductId = String(formData.get("enrollment_product_id") ?? "").trim();
  const enrollmentEffectiveOn = dateOrNull(formData.get("enrollment_effective_on"));
  const enrollmentReason = String(formData.get("enrollment_reason") ?? "").trim();
  const paymentMinor = moneyToMinor(formData.get("payment_amount"));
  const paymentMethod = String(formData.get("payment_method") ?? "").trim();
  const paymentEffectiveOn = dateOrNull(formData.get("payment_effective_on"));
  const paymentReference = String(formData.get("payment_reference") ?? "").trim();
  const paymentNotes = String(formData.get("payment_notes") ?? "").trim();
  const paymentDueOn = dateOrNull(formData.get("payment_due_on"));
  const collectionNote = String(formData.get("collection_note") ?? "").trim();
  const allowPendingAccess = formData.get("allow_pending_access") === "on";
  const pendingAccessReason = String(formData.get("pending_access_reason") ?? "").trim();
  const priorCreditsUsed = Number(formData.get("prior_credits_used") ?? 0);
  const priorCreditsReason = String(formData.get("prior_credits_reason") ?? "").trim();

  if (!studentId || !productId || !idempotencyKey) {
    redirectError(studentId, "invalid_request");
  }
  if (!["today", "specific", "first_attendance"].includes(startMode)) {
    redirectError(studentId, "package_start_mode_invalid");
  }
  if (startMode === "specific" && !packageStartsOn) {
    redirectError(studentId, "package_start_date_required");
  }
  if (paymentMinor === null) redirectError(studentId, "payment_invalid");
  if (!Number.isInteger(priorCreditsUsed) || priorCreditsUsed < 0 || priorCreditsUsed > 100000) {
    redirectError(studentId, "prior_credits_invalid");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SALES_WRITE);

  const [{ data: student }, { data: product }] = await Promise.all([
    supabase
      .from("students")
      .select("id")
      .eq("id", studentId)
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .maybeSingle(),
    supabase
      .from("product_templates")
      .select("id,price_minor")
      .eq("id", productId)
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("product_type", "package")
      .maybeSingle(),
  ]);

  if (!student) redirectError(studentId, "student_not_operable");
  if (!product) redirectError(studentId, "package_not_available");

  let packageDiscountMinor = 0;
  let packageDiscountKind: string | null = null;
  let packageDiscountInput: string | null = null;

  if (discountMode === "percentage") {
    const percentage = Number(discountValue);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      redirectError(studentId, "discount_invalid");
    }
    packageDiscountMinor = Math.round((product.price_minor * percentage) / 100);
    packageDiscountKind = "percentage";
    packageDiscountInput = `${percentage}%`;
  } else if (discountMode === "amount") {
    const amountMinor = moneyToMinor(discountValue);
    if (amountMinor === null || amountMinor <= 0 || amountMinor > product.price_minor) {
      redirectError(studentId, "discount_invalid");
    }
    packageDiscountMinor = amountMinor;
    packageDiscountKind = "amount";
    packageDiscountInput = discountValue;
  } else if (discountMode === "courtesy") {
    packageDiscountMinor = product.price_minor;
    packageDiscountKind = "courtesy";
    packageDiscountInput = "100%";
  } else if (discountMode !== "none") {
    redirectError(studentId, "discount_invalid");
  }

  if (packageDiscountMinor > 0 && !discountReason) {
    redirectError(studentId, "discount_reason_required");
  }

  const { data, error } = await supabase.rpc("create_student_onboarding_sale_v2", {
    target_student_id: studentId,
    target_package_product_id: productId,
    target_enrollment_product_id: enrollmentProductId || null,
    target_idempotency_key: idempotencyKey,
    package_start_mode: startMode,
    package_starts_on: startMode === "specific" ? packageStartsOn : null,
    package_discount_minor: packageDiscountMinor,
    package_discount_kind: packageDiscountKind,
    package_discount_input: packageDiscountInput,
    package_discount_reason: discountReason || null,
    enrollment_resolution: enrollmentResolution,
    enrollment_effective_on: enrollmentEffectiveOn,
    enrollment_reason: enrollmentReason || null,
    initial_payment_minor: paymentMinor,
    payment_method: paymentMethod || null,
    payment_effective_on: paymentMinor > 0 ? paymentEffectiveOn : null,
    payment_reference: paymentReference || null,
    payment_notes: paymentNotes || null,
    payment_due_on: paymentDueOn,
    collection_note: collectionNote || null,
    allow_pending_access: allowPendingAccess,
    pending_access_reason: pendingAccessReason || null,
    prior_credits_used: priorCreditsUsed,
    prior_credits_reason: priorCreditsReason || null,
  });

  if (error) {
    redirectError(studentId, rpcErrorCode(error.message));
  }

  const result = (data ?? {}) as { sale_id?: string };
  if (!result.sale_id) redirectError(studentId, "onboarding_sale_failed");

  revalidatePath("/admin/alumnas");
  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/admin/ventas");
  revalidatePath(`/admin/ventas/${result.sale_id}`);
  revalidatePath("/admin");

  redirect(
    `/admin/alumnas/${studentId}/alta?completed=1&sale=${encodeURIComponent(result.sale_id)}#confirmar-alta`,
  );
}
