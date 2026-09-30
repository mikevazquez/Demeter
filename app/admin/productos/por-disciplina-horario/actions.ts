"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

export type CreateRestrictedPackageState = {
  error: string | null;
};

const PACKAGE_TERM_DAYS = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
} as const;

type PackageTerm = keyof typeof PACKAGE_TERM_DAYS | "custom";
type ScopeKey = "disciplina" | "horario";

function positiveInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isPackageTerm(value: string): value is PackageTerm {
  return value === "custom" || value in PACKAGE_TERM_DAYS;
}

function isScopeKey(value: string): value is ScopeKey {
  return value === "disciplina" || value === "horario";
}

export async function createRestrictedPackage(
  _previousState: CreateRestrictedPackageState,
  formData: FormData,
): Promise<CreateRestrictedPackageState> {
  const ctx = await getAdminContext("products.write");

  const scopeRaw = String(formData.get("scope") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = Number(formData.get("price") ?? 0);
  const creditLimit = positiveInteger(formData.get("credit_limit"));
  const packageTermRaw = String(formData.get("package_term") ?? "");
  const customValidityDays = positiveInteger(formData.get("validity_days"));

  if (!isScopeKey(scopeRaw)) return { error: "Selecciona un tipo de restricción válido." };
  if (!name) return { error: "Escribe un nombre para el paquete." };
  if (!Number.isFinite(price) || price < 0) return { error: "Escribe un precio válido." };
  if (!creditLimit) return { error: "La cantidad de clases debe ser mayor a cero." };
  if (!isPackageTerm(packageTermRaw)) return { error: "Selecciona una vigencia válida." };

  const packageTerm: PackageTerm = packageTermRaw;
  const validityDays =
    packageTerm === "custom" ? customValidityDays : PACKAGE_TERM_DAYS[packageTerm];

  if (!validityDays) return { error: "La vigencia debe ser mayor a cero." };

  const { data: activeDisciplines, error: disciplinesError } = await ctx.supabase
    .from("disciplines")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true);

  if (disciplinesError || !activeDisciplines?.length) {
    return { error: "No pudimos cargar las disciplinas activas del estudio." };
  }

  let disciplineIds: string[] = [];
  let scheduleIds: string[] = [];

  if (scopeRaw === "disciplina") {
    disciplineIds = [...new Set(formData.getAll("discipline_ids").map(String).filter(Boolean))];

    if (!disciplineIds.length) {
      return { error: "Selecciona al menos una disciplina." };
    }

    const activeIds = new Set(activeDisciplines.map((item) => item.id));
    if (disciplineIds.some((id) => !activeIds.has(id))) {
      return { error: "Hay una disciplina seleccionada que ya no está disponible." };
    }

    if (disciplineIds.length >= activeDisciplines.length) {
      return {
        error:
          "Si el paquete aplica a todas las disciplinas, créalo en “Por clases”. Aquí debe quedar al menos una disciplina fuera.",
      };
    }
  } else {
    scheduleIds = [...new Set(formData.getAll("schedule_ids").map(String).filter(Boolean))];

    if (!scheduleIds.length) {
      return { error: "Selecciona al menos un horario." };
    }

    const { data: schedules, error: scheduleError } = await ctx.supabase
      .from("recurring_schedules")
      .select("id,template_id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .in("id", scheduleIds);

    if (scheduleError || schedules?.length !== scheduleIds.length) {
      return { error: "Hay un horario seleccionado que ya no está disponible." };
    }

    const templateIds = [...new Set((schedules ?? []).map((item) => item.template_id))];
    const { data: templates, error: templateError } = await ctx.supabase
      .from("class_templates")
      .select("id,discipline_id")
      .eq("studio_id", ctx.studio.id)
      .in("id", templateIds);

    if (templateError || templates?.length !== templateIds.length) {
      return { error: "No pudimos identificar las disciplinas de los horarios seleccionados." };
    }

    disciplineIds = [
      ...new Set(
        (templates ?? [])
          .map((template) => template.discipline_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (!disciplineIds.length) {
      return { error: "Los horarios seleccionados no tienen una disciplina válida." };
    }
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

  const rollback = async () => {
    await ctx.supabase
      .from("product_templates")
      .delete()
      .eq("id", product.id)
      .eq("studio_id", ctx.studio.id);
  };

  const { error: disciplineLinkError } = await ctx.supabase
    .from("product_template_disciplines")
    .insert(
      disciplineIds.map((disciplineId) => ({
        studio_id: ctx.studio.id,
        product_template_id: product.id,
        discipline_id: disciplineId,
      })),
    );

  if (disciplineLinkError) {
    await rollback();
    return { error: "No pudimos vincular las disciplinas al paquete." };
  }

  if (scheduleIds.length) {
    const { error: scheduleLinkError } = await ctx.supabase
      .from("product_template_schedules")
      .insert(
        scheduleIds.map((scheduleId) => ({
          studio_id: ctx.studio.id,
          product_template_id: product.id,
          recurring_schedule_id: scheduleId,
        })),
      );

    if (scheduleLinkError) {
      await rollback();
      return { error: "No pudimos vincular los horarios al paquete." };
    }
  }

  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/por-disciplina-horario");
  revalidatePath(`/admin/productos/por-disciplina-horario/${scopeRaw}`);
  redirect(`/admin/productos/por-disciplina-horario/${scopeRaw}`);
}
