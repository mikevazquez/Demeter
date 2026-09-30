"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

const EXPENSE_CATEGORIES = new Set([
  "rent",
  "payroll",
  "utilities",
  "advertising",
  "maintenance",
  "software",
  "supplies",
  "fees",
  "taxes",
  "other",
]);

function intelligenceFinanceUrl(formData: FormData, suffix = "") {
  const days = String(formData.get("days") ?? "30");
  const safeDays = ["7", "30", "90"].includes(days) ? days : "30";
  return "/admin/inteligencia?view=finanzas&days=" + safeDays + suffix;
}

export async function createStudioExpense(formData: FormData) {
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const vendor = String(formData.get("vendor") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const marketingSource =
    String(formData.get("marketing_source") ?? "").trim() || null;
  const marketingCampaign =
    String(formData.get("marketing_campaign") ?? "").trim() || null;
  const effectiveOn = String(formData.get("effective_on") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(",", "."));

  if (
    !EXPENSE_CATEGORIES.has(category) ||
    !description ||
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn) ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    redirect(intelligenceFinanceUrl(formData, "&error=expense_invalid"));
  }

  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { error } = await supabase.from("studio_expenses").insert({
    studio_id: studio.id,
    category,
    description,
    vendor,
    notes,
    effective_on: effectiveOn,
    amount_minor: Math.round(amount * 100),
    currency: studio.currency,
    marketing_source: category === "advertising" ? marketingSource : null,
    marketing_campaign: category === "advertising" ? marketingCampaign : null,
    created_by: user.id,
  });

  if (error) {
    redirect(intelligenceFinanceUrl(formData, "&error=expense_save"));
  }

  revalidatePath("/admin/inteligencia");
  redirect(intelligenceFinanceUrl(formData, "&created=expense"));
}

export async function deleteStudioExpense(formData: FormData) {
  const expenseId = String(formData.get("expense_id") ?? "").trim();
  if (!expenseId) {
    redirect(intelligenceFinanceUrl(formData, "&error=expense_delete"));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { error } = await supabase
    .from("studio_expenses")
    .delete()
    .eq("id", expenseId)
    .eq("studio_id", studio.id);

  if (error) {
    redirect(intelligenceFinanceUrl(formData, "&error=expense_delete"));
  }

  revalidatePath("/admin/inteligencia");
  redirect(intelligenceFinanceUrl(formData, "&created=expense_deleted"));
}
