"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export async function setEnrollmentPolicyAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const enabled = formData.get("enabled") === "on";
  const requiredForBooking = formData.get("required_for_booking") === "on";
  const requiredForPackagePurchase =
    formData.get("required_for_package_purchase") === "on";
  const requiredForSingleClass =
    formData.get("required_for_single_class") === "on";
  const singleClassGraceCount = Number(formData.get("single_class_grace_count") ?? 0);
  const productId = String(formData.get("product_template_id") ?? "").trim() || null;

  if (
    !Number.isInteger(singleClassGraceCount) ||
    singleClassGraceCount < 0 ||
    singleClassGraceCount > 100
  ) {
    redirect("/admin/ventas/inscripcion?error=single_class_grace_invalid");
  }

  const { data: currentPolicy } = await ctx.supabase
    .from("enrollment_policies")
    .select("rules")
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  const { error } = await ctx.supabase.rpc("set_enrollment_policy_v2", {
    target_studio_id: ctx.studio.id,
    target_enabled: enabled,
    target_required_for_booking: requiredForBooking,
    target_required_for_package_purchase: requiredForPackagePurchase,
    target_required_for_single_class: requiredForSingleClass,
    target_single_class_grace_count: singleClassGraceCount,
    target_product_template_id: productId,
    target_rules: currentPolicy?.rules ?? {},
  });

  if (error) {
    redirect(`/admin/ventas/inscripcion?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/ventas/inscripcion");
  revalidatePath("/admin/ventas/nueva");
  redirect("/admin/ventas/inscripcion?updated=1");
}
