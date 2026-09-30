"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

export type CreateUnlimitedState = {
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

export async function createUnlimitedMembership(
  _previousState: CreateUnlimitedState,
  formData: FormData,
): Promise<CreateUnlimitedState> {
  const ctx = await getAdminContext("products.write");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = Number(formData.get("price") ?? 0);
  const packageTermRaw = String(formData.get("package_term") ?? "");
  const validityInput = positiveInteger(formData.get("validity_days"));

  if (!name) return { error: "Escribe un nombre para la membresía." };
  if (!Number.isFinite(price) || price < 0) return { error: "Escribe un precio válido." };
  if (!isPackageTerm(packageTermRaw)) return { error: "Selecciona una vigencia válida." };

  const packageTerm: PackageTerm = packageTermRaw;
  const validityDays = packageTerm === "custom" ? validityInput : PACKAGE_TERM_DAYS[packageTerm];

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
      error: "Primero necesitas al menos una disciplina activa para crear una membresía ilimitada.",
    };
  }

  const { data: product, error: productError } = await ctx.supabase
    .from("product_templates")
    .insert({
      studio_id: ctx.studio.id,
      name,
      description,
      product_type: "membership",
      package_term: packageTerm,
      price_minor: Math.round(price * 100),
      currency: ctx.studio.currency,
      credit_limit: null,
      validity_days: validityDays,
      unlimited: true,
      active: true,
    })
    .select("id")
    .single();

  if (productError || !product) {
    return { error: "No pudimos guardar la membresía. Intenta nuevamente." };
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

    return { error: "No pudimos vincular la membresía con las disciplinas del estudio." };
  }

  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/ilimitados");
  revalidatePath(`/admin/productos/ilimitados/${packageTerm}`);
  redirect(`/admin/productos/ilimitados/${packageTerm}`);
}
