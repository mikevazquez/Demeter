import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { saveKioskConfiguration } from "./actions";
export default async function KioskSettings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [ctx, query] = await Promise.all([
    getAdminContext(CAPABILITIES.SETTINGS_WRITE),
    searchParams,
  ]);
  const { data, error } = await ctx.supabase.rpc("admin_kiosk_configuration", {
    target_studio_id: ctx.studio.id,
  });
  if (error) throw new Error("kiosk_settings_unavailable");
  const settings = data as { configured: boolean; message: string };
  return (
    <main className="portal-page dashboard-shell flow-more">
      <Link className="flow-back" href="/admin/configuracion">
        ‹ Configuración del estudio
      </Link>
      <h1>Kiosco de asistencia</h1>
      {query.error ? (
        <p role="alert">No pudimos guardar. Revisa el PIN de cuatro dígitos.</p>
      ) : query.saved ? (
        <p role="status">Configuración guardada</p>
      ) : null}
      <form action={saveKioskConfiguration} className="flow-card">
        <label>
          Mensaje extra al hacer check-in
          <textarea name="message" maxLength={120} defaultValue={settings.message} />
        </label>
        <label>
          PIN para salir del kiosco
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            minLength={4}
            required={!settings.configured}
            autoComplete="new-password"
          />
        </label>
        {settings.configured ? <p>Deja el PIN vacío para conservar el actual.</p> : null}
        <button className="primary-button">Guardar</button>
      </form>
    </main>
  );
}
