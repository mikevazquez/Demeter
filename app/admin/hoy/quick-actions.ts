"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { normalizeMexicanPhone } from "@/lib/phone";

type QuickResult = { ok: boolean; message: string; student?: { id: string; fullName: string } };

type QuickSaleStudent = {
  id: string;
  fullName: string;
  preferredProductId?: string;
};

type QuickSaleProduct = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  creditLimit: number | null;
  validityDays: number | null;
  unlimited: boolean;
};

export async function loadQuickSaleProducts(): Promise<QuickSaleProduct[]> {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { data } = await supabase
    .from("product_templates")
    .select("id,name,price_minor,currency,credit_limit,validity_days,unlimited")
    .eq("studio_id", studio.id)
    .in("product_type", ["package", "membership"])
    .eq("active", true)
    .order("price_minor");

  return (data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    priceMinor: item.price_minor,
    currency: item.currency,
    creditLimit: item.credit_limit,
    validityDays: item.validity_days,
    unlimited: item.unlimited,
  }));
}

export async function searchQuickSaleStudents(search: string): Promise<QuickSaleStudent[]> {
  const normalized = search.trim();
  if (normalized.length < 2) return [];

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { data: students } = await supabase
    .from("students")
    .select("id,full_name")
    .eq("studio_id", studio.id)
    .eq("active", true)
    .eq("lifecycle_status", "active")
    .ilike("full_name", `%${normalized}%`)
    .order("full_name")
    .limit(7);

  const studentIds = (students ?? []).map((student) => student.id);
  const { data: acquisitions } = studentIds.length
    ? await supabase
        .from("product_acquisitions")
        .select("student_id,product_template_id,created_at")
        .eq("studio_id", studio.id)
        .in("student_id", studentIds)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] as { student_id: string | null; product_template_id: string; created_at: string }[] };

  const preferredByStudent = new Map<string, string>();
  for (const acquisition of acquisitions ?? []) {
    if (
      acquisition.student_id &&
      acquisition.product_template_id &&
      !preferredByStudent.has(acquisition.student_id)
    ) {
      preferredByStudent.set(acquisition.student_id, acquisition.product_template_id);
    }
  }

  return (students ?? []).map((student) => ({
    id: student.id,
    fullName: student.full_name,
    preferredProductId: preferredByStudent.get(student.id),
  }));
}

function moneyToMinor(value: FormDataEntryValue | null) {
  const raw = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
export async function createQuickStudent(formData: FormData): Promise<QuickResult> {
  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  const email =
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase() || null;
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));
  if (!first) return { ok: false, message: "Escribe el nombre." };
  if (!phone) return { ok: false, message: "Escribe un teléfono válido de 10 dígitos." };
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data: existing } = await supabase
    .from("students")
    .select("id,full_name")
    .eq("studio_id", studio.id)
    .eq("phone", phone)
    .maybeSingle();
  if (existing) return { ok: false, message: `Ese teléfono ya pertenece a ${existing.full_name}.` };
  const { data: id, error } = await supabase.rpc("admin_create_student", {
    p_first_name: first,
    p_last_name: last || null,
    p_phone: phone,
    p_email: email,
  });
  if (error || typeof id !== "string")
    return {
      ok: false,
      message: error?.message.includes("plan_limit_exceeded")
        ? "Se alcanzó el límite de alumnas activas del plan."
        : "No se pudo crear la alumna.",
    };
  revalidatePath("/admin");
  revalidatePath("/admin/alumnas");
  const fullName = [first, last].filter(Boolean).join(" ");
  return { ok: true, message: `${fullName} fue creada.`, student: { id, fullName } };
}

export async function createQuickSale(formData: FormData): Promise<QuickResult> {
  const studentId = String(formData.get("student_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const discountMode = String(formData.get("discount_mode") ?? "none");
  const discountValue = String(formData.get("discount_value") ?? "");
  const discountReason = String(formData.get("discount_reason") ?? "").trim();
  const paymentMinor = moneyToMinor(formData.get("payment_amount"));
  const paymentMethod = String(formData.get("payment_method") ?? "").trim();
  if (!studentId || !productId || paymentMinor === null)
    return { ok: false, message: "Revisa los datos de la venta." };
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const today = localDate(studio.timezone);
  const [{ data: student }, { data: product }, { data: policy }, { data: activeEnrollments }] =
    await Promise.all([
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
        .in("product_type", ["package", "membership"])
        .maybeSingle(),
      supabase
        .from("enrollment_policies")
        .select("enabled,required_for_package_purchase")
        .eq("studio_id", studio.id)
        .maybeSingle(),
      supabase
        .from("student_enrollments")
        .select("id,starts_on,expires_on,status")
        .eq("studio_id", studio.id)
        .eq("student_id", studentId)
        .eq("status", "active"),
    ]);
  if (!student || !product)
    return { ok: false, message: "La alumna o el paquete ya no están disponibles." };
  const enrollmentRequired = Boolean(policy?.enabled && policy.required_for_package_purchase);
  const currentEnrollment = (activeEnrollments ?? []).some(
    (x) => x.starts_on <= today && (x.expires_on === null || x.expires_on >= today),
  );
  if (enrollmentRequired && !currentEnrollment)
    return {
      ok: false,
      message: "Esta alumna necesita resolver su inscripción antes de esta venta.",
    };
  let discountMinor = 0,
    discountKind: string | null = null,
    discountInput: string | null = null;
  if (discountMode === "percentage") {
    const n = Number(discountValue);
    if (!Number.isFinite(n) || n <= 0 || n > 100)
      return { ok: false, message: "Revisa el porcentaje de descuento." };
    discountMinor = Math.round((product.price_minor * n) / 100);
    discountKind = "percentage";
    discountInput = `${n}%`;
  } else if (discountMode === "amount") {
    const n = moneyToMinor(discountValue);
    if (n === null || n <= 0 || n > product.price_minor)
      return { ok: false, message: "Revisa el monto del descuento." };
    discountMinor = n;
    discountKind = "amount";
    discountInput = discountValue;
  } else if (discountMode === "courtesy") {
    discountMinor = product.price_minor;
    discountKind = "courtesy";
    discountInput = "100%";
  }
  if (discountMinor > 0 && !discountReason)
    return { ok: false, message: "Indica el motivo del descuento." };
  const total = Math.max(product.price_minor - discountMinor, 0);
  if (paymentMinor > total) return { ok: false, message: "El pago no puede superar el total." };
  if (paymentMinor > 0 && !paymentMethod)
    return { ok: false, message: "Selecciona el método de pago." };
  if (paymentMinor < total)
    return {
      ok: false,
      message:
        "Para el atajo registra el pago completo o $0. Las ventas con saldo pendiente se gestionan desde el flujo completo.",
    };
  const { error } = await supabase.rpc("create_student_onboarding_sale_v2", {
    target_student_id: studentId,
    target_package_product_id: productId,
    target_enrollment_product_id: null,
    target_idempotency_key: crypto.randomUUID(),
    package_start_mode: "today",
    package_starts_on: null,
    package_discount_minor: discountMinor,
    package_discount_kind: discountKind,
    package_discount_input: discountInput,
    package_discount_reason: discountReason || null,
    enrollment_resolution: enrollmentRequired ? "already_active" : "not_required",
    enrollment_effective_on: null,
    enrollment_reason: null,
    initial_payment_minor: paymentMinor,
    payment_method: paymentMinor > 0 ? paymentMethod : null,
    payment_effective_on: paymentMinor > 0 ? today : null,
    payment_reference: null,
    payment_notes: null,
    payment_due_on: null,
    collection_note: paymentMinor === 0 ? "Venta rápida registrada desde Hoy" : null,
    allow_pending_access: false,
    pending_access_reason: null,
    prior_credits_used: 0,
    prior_credits_reason: null,
  });
  if (error) return { ok: false, message: "No se pudo registrar la venta: " + error.message };
  revalidatePath("/admin");
  revalidatePath("/admin/ventas");
  revalidatePath("/admin/alumnas");
  return { ok: true, message: "Venta registrada correctamente." };
}
