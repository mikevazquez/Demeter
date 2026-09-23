import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { sendAsistianHandshake, sendAsistianMappingProbe } from "./actions";

const errorCopy: Record<string, string> = {
  invalid_url: "La URL no es válida. Debe ser una URL HTTPS de Asistian.",
  invalid_secret: "El Signing Secret no parece válido.",
  network: "No se pudo conectar con Asistian.",
  http: "Asistian rechazó el webhook.",
  save: "No se pudieron guardar las credenciales del webhook.",
};

export default async function AsistianIntegrationTestPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    mapping_sent?: string;
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
          <h1 className="dashboard-title">Pruebas de Webhook</h1>
          <p>Captura primero las variables y después configura la conexión firmada.</p>
        </div>
      </header>

      {query.mapping_sent === "1" ? (
        <div className="notice success">
          Payload de mapeo enviado
          {query.status ? ` · HTTP ${query.status}` : ""}. Revisa Asistian.
        </div>
      ) : null}

      {query.sent === "1" ? (
        <div className="notice success">
          Webhook firmado enviado
          {query.status ? ` · HTTP ${query.status}` : ""}.
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
            <p className="eyebrow">PASO 1 · MAPEO</p>
            <h2>Capturar variables de confirmación</h2>
          </div>
        </div>

        <form action={sendAsistianMappingProbe} className="compact-form">
          <label>
            URL de prueba de Asistian
            <input type="url" name="test_webhook_url" placeholder="https://…" autoComplete="off" required />
          </label>
          <p className="text-sm text-zinc-400">
            Con Probar Webhook escuchando, esta prueba envía datos sintéticos con nombre,
            disciplina, fecha, hora, coach y ubicación.
          </p>
          <button className="primary-button" type="submit">
            Enviar las 6 variables
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PASO 2 · PRODUCCIÓN</p>
            <h2>Conexión firmada</h2>
          </div>
        </div>

        <form action={sendAsistianHandshake} className="compact-form">
          <label>
            URL de Webhook de Producción
            <input type="url" name="webhook_url" placeholder="https://…" autoComplete="off" required />
          </label>
          <label>
            Secreto de firma
            <input type="password" name="signing_secret" placeholder="Pega aquí el secreto" autoComplete="off" required />
          </label>
          <button className="primary-button" type="submit">
            Guardar y enviar prueba firmada
          </button>
        </form>
      </section>
    </main>
  );
}
