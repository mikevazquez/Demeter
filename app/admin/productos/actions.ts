"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

const TYPES = new Set(["package", "membership", "single_class", "other"]);

function parsePositiveInt(value: FormDataEntryValue | null, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field}_invalid`);
  return parsed;
}

export async function createProduct(formData: FormData) {
  const ctx = await getAdminContext("products.write");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const productType = String(formData.get("product_type") ?? "");
  const unlimited = formData.get("unlimited") === "on";
  const pricePesos = Number(formData.get("price") ?? 0);
  const validityDays = parsePositiveInt(formData.get("validity_days"), "validity_days");
  const creditLimit = unlimited
    ? null
    : parsePositiveInt(formData.get("credit_limit"), "credit_limit");
  const disciplineIds = formData.getAll("discipline_ids").map(String).filter(Boolean);

  if (!name) throw new Error("name_required");
  if (!TYPES.has(productType)) throw new Error("product_type_invalid");
  if (!Number.isFinite(pricePesos) || pricePesos < 0) throw new Error("price_invalid");

  const priceMinor = Math.round(pricePesos * 100);
  const { data: product, error } = await ctx.supabase
    .from("product_templates")
    .insert({
      studio_id: ctx.studio.id,
      name,
      description,
      product_type: productType,
      price_minor: priceMinor,
      currency: "MXN",
      credit_limit: creditLimit,
      validity_days: validityDays,
      unlimited,
    })
    .select("id")
    .single();

  if (error || !product) throw new Error(error?.message ?? "product_create_failed");

  if (disciplineIds.length) {
    const { error: disciplineError } = await ctx.supabase
      .from("product_template_disciplines")
      .insert(
        disciplineIds.map((disciplineId) => ({
          studio_id: ctx.studio.id,
          product_template_id: product.id,
          discipline_id: disciplineId,
        })),
      );
    if (disciplineError) throw new Error(disciplineError.message);
  }

  revalidatePath("/admin/productos");
  redirect(`/admin/productos/${product.id}`);
}

export async function setProductActive(formData: FormData) {
  const ctx = await getAdminContext("products.write");
  const productId = String(formData.get("product_id") ?? "");
  const active = String(formData.get("active")) === "true";
  const { error } = await ctx.supabase
    .from("product_templates")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("studio_id", ctx.studio.id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/productos");
  revalidatePath(`/admin/productos/${productId}`);
}
