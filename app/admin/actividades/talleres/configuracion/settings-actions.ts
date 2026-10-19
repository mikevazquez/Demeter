"use server";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
export async function saveWorkshopDemiSettings(
  _state: { error: string | null; saved: boolean },
  data: FormData,
): Promise<{ error: string | null; saved: boolean }> {
  const ctx = await getAdminContext("settings.write");
  if (!ctx.can("schedule.write"))
    return { error: "Necesitas permisos para configurar reservas.", saved: false };
  const result = await (async () => {
    try {
      return await ctx.supabase.rpc("admin_workshop_demi_settings", {
        p_studio: ctx.studio.id,
        p_enabled: data.get("enabled") === "on",
      });
    } catch {
      return { error: { message: "Result unverified" }, data: null };
    }
  })();
  if (result.error || typeof result.data?.enabled !== "boolean")
    return {
      error: "No pudimos guardar la configuración. Vuelve a consultar su estado.",
      saved: false,
    };
  revalidatePath("/admin/actividades/talleres/configuracion");
  return { error: null, saved: true };
}
