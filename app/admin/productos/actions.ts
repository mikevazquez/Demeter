"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

const TYPES = new Set(["package", "membership", "single_class", "enrollment", "other"]);
const PACKAGE_TERMS = new Set(["monthly", "quarterly", "semiannual", "annual", "custom"]);
const PACKAGE_TERM_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
};

function parsePositiveInt(value: FormDataEntryValue | null, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field}_invalid`);
  return parsed;
}

function parseProductForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const productType = String(formData.get("product_type") ?? "");
  const isEnrollment = productType === "enrollment";
  const isPackageLike = productType === "package" || productType === "membership";
  const unlimited = isEnrollment ? false : formData.get("unlimited") === "on";
  const pricePesos = Number(formData.get("price") ?? 0);
  const packageTermRaw = String(formData.get("package_term") ?? "").trim();
  const validityRaw = String(formData.get("validity_days") ?? "").trim();

  if (!name) throw new Error("name_required");
  if (!TYPES.has(productType)) throw new Error("product_type_invalid");
  if (!Number.isFinite(pricePesos) || pricePesos < 0) throw new Error("price_invalid");

  let packageTerm: string | null = null;
  let validityDays: number | null;

  if (isEnrollment) {
    validityDays =
      isEnrollment && !validityRaw ? null : parsePositiveInt(validityRaw, "validity_days");
  } else if (isPackageLike) {
    if (!PACKAGE_TERMS.has(packageTermRaw)) throw new Error("package_term_invalid");
    packageTerm = packageTermRaw;
    validityDays =
      packageTerm === "custom"
        ? parsePositiveInt(validityRaw, "validity_days")
        : PACKAGE_TERM_DAYS[packageTerm];
  } else {
    validityDays = parsePositiveInt(validityRaw, "validity_days");
  }

  const creditLimit = isEnrollment
    ? null
    : unlimited
      ? null
      : parsePositiveInt(formData.get("credit_limit"), "credit_limit");
  const disciplineIds = isEnrollment
    ? []
    : [...new Set(formData.getAll("discipline_ids").map(String).filter(Boolean))];

  return {
    name,
    description,
    productType,
    packageTerm,
    unlimited,
    priceMinor: Math.round(pricePesos * 100),
    validityDays,
    creditLimit,
    disciplineIds,
  };
}

async function validateDisciplines(
  ctx: Awaited<ReturnType<typeof getAdminContext>>,
  disciplineIds: string[],
) {
  if (!disciplineIds.length) return;
  const { data, error } = await ctx.supabase
    .from("disciplines")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .in("id", disciplineIds);
  if (error || data?.length !== disciplineIds.length) throw new Error("discipline_invalid");
}

export async function createProduct(formData: FormData) {
  const ctx = await getAdminContext("products.write");
  const values = parseProductForm(formData);
  await validateDisciplines(ctx, values.disciplineIds);

  const { data: product, error } = await ctx.supabase
    .from("product_templates")
    .insert({
      studio_id: ctx.studio.id,
      name: values.name,
      description: values.description,
      product_type: values.productType,
      package_term: values.packageTerm,
      price_minor: values.priceMinor,
      currency: "MXN",
      credit_limit: values.creditLimit,
      validity_days: values.validityDays,
      unlimited: values.unlimited,
    })
    .select("id")
    .single();

  if (error || !product) throw new Error(error?.message ?? "product_create_failed");

  if (values.disciplineIds.length) {
    const { error: disciplineError } = await ctx.supabase
      .from("product_template_disciplines")
      .insert(
        values.disciplineIds.map((disciplineId) => ({
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

export async function updateProduct(formData: FormData) {
  const ctx = await getAdminContext("products.write");
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) throw new Error("product_required");
  const values = parseProductForm(formData);
  await validateDisciplines(ctx, values.disciplineIds);

  const { data: product, error } = await ctx.supabase
    .from("product_templates")
    .update({
      name: values.name,
      description: values.description,
      product_type: values.productType,
      package_term: values.packageTerm,
      price_minor: values.priceMinor,
      credit_limit: values.creditLimit,
      validity_days: values.validityDays,
      unlimited: values.unlimited,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("studio_id", ctx.studio.id)
    .select("id")
    .maybeSingle();
  if (error || !product) throw new Error(error?.message ?? "product_update_failed");

  const { error: deleteError } = await ctx.supabase
    .from("product_template_disciplines")
    .delete()
    .eq("studio_id", ctx.studio.id)
    .eq("product_template_id", productId);
  if (deleteError) throw new Error(deleteError.message);

  if (values.disciplineIds.length) {
    const { error: insertError } = await ctx.supabase.from("product_template_disciplines").insert(
      values.disciplineIds.map((disciplineId) => ({
        studio_id: ctx.studio.id,
        product_template_id: productId,
        discipline_id: disciplineId,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath("/admin/productos");
  revalidatePath(`/admin/productos/${productId}`);
  redirect(`/admin/productos/${productId}?updated=1`);
}

export async function duplicateProduct(formData: FormData) {
  const ctx = await getAdminContext("products.write");
  const productId = String(formData.get("product_id") ?? "");
  const { data: source } = await ctx.supabase
    .from("product_templates")
    .select(
      "name,description,product_type,package_term,price_minor,currency,credit_limit,validity_days,unlimited,product_template_disciplines(discipline_id)",
    )
    .eq("id", productId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  if (!source) throw new Error("product_not_found");

  const { data: copy, error } = await ctx.supabase
    .from("product_templates")
    .insert({
      studio_id: ctx.studio.id,
      name: `${source.name} · copia`,
      description: source.description,
      product_type: source.product_type,
      package_term: source.package_term,
      price_minor: source.price_minor,
      currency: source.currency,
      credit_limit: source.credit_limit,
      validity_days: source.validity_days,
      unlimited: source.unlimited,
      active: false,
    })
    .select("id")
    .single();
  if (error || !copy) throw new Error(error?.message ?? "product_duplicate_failed");

  const disciplineIds = (source.product_template_disciplines ?? []).map(
    (item) => item.discipline_id,
  );
  if (disciplineIds.length) {
    const { error: disciplineError } = await ctx.supabase
      .from("product_template_disciplines")
      .insert(
        disciplineIds.map((disciplineId) => ({
          studio_id: ctx.studio.id,
          product_template_id: copy.id,
          discipline_id: disciplineId,
        })),
      );
    if (disciplineError) throw new Error(disciplineError.message);
  }

  revalidatePath("/admin/productos");
  redirect(`/admin/productos/${copy.id}/editar?duplicated=1`);
}

export async function setProductActive(formData: FormData) {
  const ctx = await getAdminContext("products.write");
  const productId = String(formData.get("product_id") ?? "");
  const active = String(formData.get("active")) === "true";
  const { data: product, error } = await ctx.supabase
    .from("product_templates")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("studio_id", ctx.studio.id)
    .select("id")
    .maybeSingle();
  if (error || !product) throw new Error(error?.message ?? "product_status_failed");
  revalidatePath("/admin/productos");
  revalidatePath(`/admin/productos/${productId}`);
  redirect(`/admin/productos/${productId}?status=${active ? "activated" : "deactivated"}`);
}
