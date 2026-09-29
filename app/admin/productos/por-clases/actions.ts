"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

export type CreateClassPackageState = {
  error: string | null;
};

function positiveInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function createClassPackage(
  _previousState: CreateClassPackageState,
  formData: FormData,
): Promise<CreateClassPackageState> {
  const ctx = await getAdminContext("products.write");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = Number(formData.get("price") ?? 0);
  const creditLimit = positiveInteger(formData.get("credit_limit"));
  const validityDays = positiveInteger(formData.get("validity_days"));

  if (!name) return { error: "Escribe un nombre para el paquete." };
  if (!Number.isFinite(price) || price < 0) return { error: "Escribe un precio válido." };
  if (!creditLimit) return { error: "La cantidad de clases debe ser mayor a cero." };
  if (!validityDays) return { error: "La vigencia debe ser mayor a cero." };

  const { data: disciplines, error: disciplinesError } = await ctx.supabase
    .from("disciplines")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true);

  if (disciplinesError) {
    return { error: "No pudimos cargar las disciplinas del estudio." };
  }

  if (!disciplines?.length) {
    return {
      error:
        "Primero necesitas al menos una disciplina activa. Este tipo de paquete aplica a todas.",
    };
  }

  const { data: product, error: productError } = await ctx.supabase
    .from("product_templates")
    .insert({
      studio_id: ctx.studio.id,
      name,
      description,
      product_type: "package",
      package_term: "custom",
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

  const { error: disciplineLinkError } = await ctx.supabase
    .from("product_template_disciplines")
    .insert(
      disciplines.map((discipline) => ({
        studio_id: ctx.studio.id,
        product_template_id: product.id,
        discipline_id: discipline.id,
      })),
    );

  if (disciplineLinkError) {
    await ctx.supabase
      .from("product_templates")
      .delete()
      .eq("id", product.id)
      .eq("studio_id", ctx.studio.id);

    return { error: "No pudimos vincular el paquete con las disciplinas del estudio." };
  }

  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/por-clases");
  redirect("/admin/productos/por-clases");
}
