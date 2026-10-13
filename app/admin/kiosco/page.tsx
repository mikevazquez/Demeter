import Link from "next/link";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { KioskScanner } from "./KioskScanner";
export default async function AdminKioskPage() {
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("admin_kiosk_configuration", {
    target_studio_id: studio.id,
  });
  if (error) throw new Error("kiosk_configuration_unavailable");
  const settings = data as { configured: boolean; message: string };
  if (!settings.configured)
    return (
      <main className="dashboard-shell flow-more">
        <h1>Configura el kiosco</h1>
        <p>Antes de abrir el check-in, configura el PIN para salir del kiosco.</p>
        <Link
          href={can(CAPABILITIES.SETTINGS_WRITE) ? "/admin/configuracion/kiosco" : "/admin"}
          className="flow-back"
        >
          {can(CAPABILITIES.SETTINGS_WRITE)
            ? "Configurar PIN"
            : "Volver y solicitar apoyo a administración"}
        </Link>
      </main>
    );
  const { data: serverNow } = await supabase.rpc("current_server_time");
  const now = new Date(serverNow as string).getTime();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("starts_at,ends_at,class_templates(name)")
    .eq("studio_id", studio.id)
    .eq("status", "scheduled")
    .gte("starts_at", new Date(now - 30 * 60_000).toISOString())
    .lte("starts_at", new Date(now + 20 * 60_000).toISOString())
    .order("starts_at")
    .limit(1);
  const session = sessions?.[0];
  const template = session?.class_templates as unknown as { name: string } | null;
  const targetClass = session
    ? { name: template?.name ?? "Tu clase", startsAt: session.starts_at, endsAt: session.ends_at }
    : null;
  return (
    <KioskScanner
      targetClass={targetClass}
      studioName={studio.name}
      timeZone={studio.timezone}
      message={settings.message}
    />
  );
}
