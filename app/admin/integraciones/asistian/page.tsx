import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { env } from "@/lib/env";

import {
  saveAsistianToStudioReceiverSecret,
  sendAsistianHandshake,
  sendAsistianMappingProbe,
} from "./actions";

const errorCopy: Record<string, string> = {
  invalid_url: "La URL no es válida. Debe ser una URL HTTPS de Asistian.",
  invalid_secret: "El Signing Secret no parece válido.",
  receiver_secret_invalid: "El secreto del webhook saliente de Asistian no parece válido.",
  receiver_secret_save: "No se pudo guardar el secreto para recibir eventos de Asistian.",
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
    receiver_saved?: string;
    error?: string;
    status?: string;
  }>;
}) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const query = await searchParams;

  const receiverUrl = `${env.supabaseUrl.replace(
    /\/+$/,
    "",
  )}/functions/v1/receive-asistian-webhook?studio=${studio.id}`;

  const { data: receivedEvents } = await supabase
    .from("asistian_webhook_events")
    .select(
      "id,event_name,provider_event_id,provider_timestamp,attempt,payload,processing_status,received_at",
    )
    .eq("studio_id", studio.id)
    .order("received_at", { ascending: false })
    .limit(10);

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">
            ← Inicio
          </Link>
          <p className="eyebrow">INTEGRACIONES · ASISTIAN</p>
          <h1 className="dashboard-title">Pruebas de Webhook</h1>
          <p>Prueba ambas direcciones sin mezclar las credenciales de cada flujo.</p>
        </div>
      </header>

      {query.receiver_saved === "1" ? (
        <div className="notice success">
          Receptor Asistian → Studio Flow configurado. Ya puedes usar “Probar” en el webhook
          saliente de Asistian.
        </div>
      ) : null}

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
            <p className="eyebrow">ASISTIAN → STUDIO FLOW · CAPTURA</p>
            <h2>Recibir una reserva real desde Asistian</h2>
          </div>
        </div>

        <div className="compact-form">
          <label>
            URL receptora de Studio Flow
            <input type="text" readOnly value={receiverUrl} />
          </label>

          <form action={saveAsistianToStudioReceiverSecret} className="compact-form">
            <label>
              Secreto del webhook saliente de Asistian
              <input
                type="password"
                name="provider_signing_secret"
                placeholder="whsec_…"
                autoComplete="off"
                required
              />
            </label>
            <p className="text-sm text-zinc-400">
              En Asistian crea un Webhook Saliente, pega la URL anterior, marca “Reserva Creada” y
              pega aquí el secreto que Asistian genera. El receptor valida HMAC, evita duplicados y
              guarda el payload para cerrar el mapeo sin adivinar campos.
            </p>
            <button className="primary-button" type="submit">
              Guardar secreto receptor
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">EVENTOS RECIBIDOS</p>
            <h2>Últimos webhooks de Asistian</h2>
          </div>
        </div>

        {!receivedEvents?.length ? (
          <p className="text-sm text-zinc-400">
            Todavía no hay eventos. Usa “Probar” en Asistian después de guardar el secreto.
          </p>
        ) : (
          <div className="compact-form">
            {receivedEvents.map((event) => (
              <details key={event.id}>
                <summary>
                  {event.event_name} · {event.processing_status} ·{" "}
                  {new Date(event.received_at).toLocaleString("es-MX", {
                    timeZone: studio.timezone ?? "America/Mexico_City",
                  })}
                </summary>
                <p className="text-sm text-zinc-400">
                  Event ID: {event.provider_event_id}
                  {event.attempt ? ` · intento ${event.attempt}` : ""}
                </p>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">STUDIO FLOW → ASISTIAN · MAPEO</p>
            <h2>Capturar variables de confirmación</h2>
          </div>
        </div>

        <form action={sendAsistianMappingProbe} className="compact-form">
          <label>
            URL de prueba de Asistian
            <input
              type="url"
              name="test_webhook_url"
              placeholder="https://…"
              autoComplete="off"
              required
            />
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
            <p className="eyebrow">STUDIO FLOW → ASISTIAN · FIRMA</p>
            <h2>Conexión firmada</h2>
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
              placeholder="Pega aquí el secreto"
              autoComplete="off"
              required
            />
          </label>
          <button className="primary-button" type="submit">
            Guardar y enviar prueba firmada
          </button>
        </form>
      </section>
    </main>
  );
}
