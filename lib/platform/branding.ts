import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// NEB-01-05 · Nombre corto de marca del estudio (studios.brand_name). Si falta la columna o el
// dato, se usa el nombre que ya tenga la pantalla, así nada se rompe ni cambia de golpe.
export async function loadStudioBrandName(
  supabase: SupabaseClient,
  studioId: string,
  fallback: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("studios")
    .select("brand_name")
    .eq("id", studioId)
    .maybeSingle();
  const brand = !error && typeof data?.brand_name === "string" ? data.brand_name.trim() : "";
  return brand || fallback;
}
