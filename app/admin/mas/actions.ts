"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

/** NEB-01-20 · Cerrar un aviso de novedad (una vez por persona). */
export async function dismissFeatureNewsAction(formData: FormData) {
  const key = String(formData.get("feature") ?? "");
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(key)) redirect("/admin/mas");
  const { supabase, studio } = await getAdminContext();
  await supabase.rpc("studio_dismiss_feature_news", { p_studio: studio.id, p_key: key });
  revalidatePath("/admin/mas");
  redirect("/admin/mas");
}
