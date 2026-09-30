"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

export type CreateActivityPackageState = {
  error: string | null;
};

const PACKAGE_TERM_DAYS = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
} as const;

type PackageTerm = keyof typeof PACKAGE_TERM_DAYS | "custom";

function positiveInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isPackageTerm(value: string): value is PackageTerm {
  return value === "custom" || value in PACKAGE_TERM_DAYS;
}

export async function createActivityPackage(
  _previousState: CreateActivityPackageState,
  formData: FormData,
): Promise<CreateActivityPackageState> {
  const ctx = await getAdminContext("products.write");

  const activityId = String(formData.get("activity_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = Number(formData.get("price") ?? 0);
  const creditLimit = positiveInteger(formData.get("credit_limit"));
  const packageTermRaw = String(formData.get("package_term") ?? "");
  const validityInput = positiveInteger(formData.get("validity_days"));

  if (!activityId) return { error: "Selecciona una actividad válida." };
  if (!name) return { error: "Escribe un nombre para el paquete." };
  if (!Number.isFinite(price) || price < 0) return { error: "Escribe un precio válido." };
  if (!creditLimit) return { error: "La cantidad de clases debe ser mayor a cero." };
  if (!isPackageTerm(packageTermRaw)) return { error: "Selecciona una vigencia válida." };

  const packageTerm: PackageTerm = packageTermRaw;
  const validityDays =
    packageTerm === "custom" ? validityInput : PACKAGE_TERM_DAYS[packageTerm];

  if (!validityDays) return { error: "La vigencia debe ser mayor a cero." };

  const { data: activity, error: activityError } = await ctx.supabase
    .from("class_templates")
    .select("id,name")
    .eq("studio_id", ctx.studio.id)
    .eq("id", activityId)
    .eq("active", true)
    .maybeSingle();

  if (activityError || !activity) {
    return { error: "La actividad ya no está disponible." };
  }

  const { data: product, error: productError } = await ctx.supabase
    .from("product_templates")
    .insert({
      studio_id: ctx.studio.id,
      name,
      description,
      product_type: "package",
      package_term: packageTerm,
      price_minor: Math.round(price * 100),
      currency: ctx.studio.currency,
      credit_limit: creditLimit,
      validity_days: validityDays,
      unlimited: false,
      active: true,
    })
    .select("id")
    .single();

  if (productError || !product) {
    return { error: "No pudimos guardar el paquete. Intenta nuevamente." };
  }

  const { error: linkError } = await ctx.supabase.from("product_template_activities").insert({
    studio_id: ctx.studio.id,
    product_template_id: product.id,
    class_template_id: activity.id,
  });

  if (linkError) {
    await ctx.supabase
      .from("product_templates")
      .delete()
      .eq("id", product.id)
      .eq("studio_id", ctx.studio.id);

    return { error: "No pudimos vincular el paquete con la actividad." };
  }

  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/cursos-talleres");
  revalidatePath(`/admin/productos/cursos-talleres/${activity.id}`);
  redirect(`/admin/productos/cursos-talleres/${activity.id}`);
}
