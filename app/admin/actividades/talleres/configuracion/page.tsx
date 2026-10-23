import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { WorkshopDemiSettings } from "./settings-form";
export default async function WorkshopSettingsPage() {
  const ctx = await getAdminContext("settings.write");
  const response = ctx.can("schedule.write")
    ? await ctx.supabase.rpc("admin_workshop_demi_settings", { p_studio: ctx.studio.id })
    : null;
  return (
    <main className="activities-v2 activities-editor-page">
      <Link href="/admin/actividades?tipo=talleres">← Talleres</Link>
      <h1>Talleres con Demi</h1>
      {response?.error || !response?.data ? (
        <p role="alert">No pudimos cargar la configuración de este estudio.</p>
      ) : (
        <WorkshopDemiSettings enabled={response.data.enabled === true} />
      )}
    </main>
  );
}
