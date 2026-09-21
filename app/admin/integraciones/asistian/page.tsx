import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { sendAsistianHandshake } from "./actions";

const errorCopy: Record<string, string> = {
  invalid_url: "La URL no es válida. Debe ser la URL HTTPS del Webhook entrante de Asistian.",
  network:
    "No se pudo conectar con Asistian. Verifica que siga en modo escucha e inténtalo de nuevo.",
  http: "Asistian rechazó el webhook de prueba.",
  save: "No se pudo guardar el webhook de Asistian en el Vault de Sandbox.",
};

export default async function AsistianIntegrationTestPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; status?: string }>;
}) {
  await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const query = await searchParams;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">
            ← Inicio
          </Link>
          <p className="eyebrow">INTEGRACIONES · ASISTIAN</p>
          <h1 className="dashboard-title">Prueba de conexión</h1>
          <p>
            Usa esta pantalla únicamente mientras Asistian esté en modo escucha. La URL se guarda
            cifrada en el Vault de Sandbox y no se expone en el repositorio ni en la auditoría.
          </p>
        </div>
      </header>

      {query.sent === "1" ? (
        <div className="notice success">
          Webhook enviado correctamente a Asistian
          {query.status ? ` · HTTP ${query.status}` : ""}. Revisa la captura de campos en Asistian.
        </div>
      ) : null}

      {query.error ? (
        <div className="notice error">
          {errorCopy[query.error] ?? "No se pudo completar la prueba."}
          {query.status ? ` · HTTP ${query.status}` : ""}
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SF-174 · HANDSHAKE</p>
            <h2>Webhook entrante de Asistian</h2>
          </div>
        </div>

        <form action={sendAsistianHandshake} className="compact-form">
          <label>
            URL del Webhook
            <input
              type="url"
              name="webhook_url"
              placeholder="https://…"
              autoComplete="off"
              required
            />
          </label>

          <p className="text-sm text-zinc-400">
            Se guardará como el webhook de <strong>student_welcome</strong> en Supabase Vault y se
            enviará un payload sintético. No contiene datos reales de alumnas ni contraseñas.
          </p>

          <button className="primary-button" type="submit">
            Guardar en Sandbox y enviar prueba
          </button>
        </form>
      </section>
    </main>
  );
}
