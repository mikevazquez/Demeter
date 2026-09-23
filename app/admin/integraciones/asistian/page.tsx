import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { sendAsistianHandshake } from "./actions";

const errorCopy: Record<string, string> = {
  invalid_url: "La URL no es válida. Debe ser la URL HTTPS del Webhook entrante de Asistian.",
  invalid_secret: "El Signing Secret no parece válido.",
  network:
    "No se pudo conectar con Asistian. Verifica que Probar Webhook siga a la escucha e inténtalo de nuevo.",
  http: "Asistian rechazó el webhook firmado.",
  save: "No se pudieron guardar las credenciales del webhook en Supabase Vault.",
};

export default async function AsistianIntegrationTestPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    error?: string;
    status?: string;
  }>;
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
          <h1 className="dashboard-title">Recordatorio de clase · 3 horas</h1>
          <p>
            Configura aquí el Webhook entrante de Asistian. Studio Flow firma el cuerpo exacto con
            HMAC-SHA256 y usa una clave de idempotencia para impedir ejecuciones duplicadas.
          </p>
        </div>
      </header>

      {query.sent === "1" ? (
        <div className="notice success">
          Webhook firmado enviado correctamente a Asistian
          {query.status ? ` · HTTP ${query.status}` : ""}. Revisa los campos capturados en Probar
          Webhook.
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
            <p className="eyebrow">CLASS-REMINDER-01 · CONEXIÓN</p>
            <h2>Webhook entrante de Asistian</h2>
          </div>
        </div>

        <form action={sendAsistianHandshake} className="compact-form">
          <label>
            URL de Webhook de Producción
            <input
              type="url"
              name="webhook_url"
              placeholder="https://…"
              autoComplete="off"
              required
            />
          </label>

          <label>
            Secreto de firma
            <input
              type="password"
              name="signing_secret"
              placeholder="Pega aquí el secreto de Asistian"
              autoComplete="off"
              required
            />
          </label>

          <p className="text-sm text-zinc-400">
            En Asistian abre la automatización y pulsa <strong>Probar Webhook</strong> antes de
            enviar esta prueba. La URL y el secreto se guardan cifrados por automatización en
            Supabase Vault. El secreto no vuelve a mostrarse.
          </p>

          <button className="primary-button" type="submit">
            Guardar y enviar prueba firmada
          </button>
        </form>
      </section>
    </main>
  );
}
