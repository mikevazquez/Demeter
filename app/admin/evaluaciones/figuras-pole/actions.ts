"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { POLE_CATALOG_SEED } from "@/lib/pole/seed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function importPoleCatalogAction(formData: FormData) {
  const disciplineId = String(formData.get("discipline_id") ?? "");
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  if (!UUID.test(disciplineId)) redirect("/admin/evaluaciones/figuras-pole?error=discipline");

  const { data: discipline } = await ctx.supabase
    .from("disciplines")
    .select("id")
    .eq("id", disciplineId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  if (!discipline) redirect("/admin/evaluaciones/figuras-pole?error=discipline");

  const { data, error } = await ctx.supabase.rpc("admin_import_pole_catalog", {
    p_discipline_id: disciplineId,
    p_payload: POLE_CATALOG_SEED,
  });

  if (error) {
    redirect(`/admin/evaluaciones/figuras-pole?discipline=${disciplineId}&error=import`);
  }

  const result = (data ?? {}) as { figures?: number };
  revalidatePath("/admin/evaluaciones/figuras-pole");
  redirect(
    `/admin/evaluaciones/figuras-pole?discipline=${disciplineId}&imported=${result.figures ?? 0}`,
  );
}
