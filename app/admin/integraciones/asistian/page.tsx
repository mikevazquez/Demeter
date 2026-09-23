import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { env } from "@/lib/env";

import {
  saveAsistianServiceMapping,
  saveAsistianToStudioReceiverSecret,
  sendAsistianHandshake,
  sendAsistianMappingProbe,
} from "./actions";

const errorCopy: Record<string, string> = {
  invalid_url: "La URL no es válida. Debe ser una URL HTTPS de Asistian.",
  invalid_secret: "El Signing Secret no parece válido.",
  receiver_secret_invalid: "El secreto del webhook saliente de Asistian no parece válido.",
  receiver_secret_save: "No se pudo guardar el secreto para recibir eventos de Asistian.",
  service_mapping_invalid:
    "Selecciona un servicio de Asistian y una actividad de Studio Flow.",
  service_mapping_save:
    "No se pudo guardar el mapeo del servicio de Asistian.",
  network: "No se pudo conectar con Asistian.",
  http: "Asistian rechazó el webhook.",
  save: "No se pudieron guardar las credenciales del webhook.",
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scalarText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export default async function AsistianIntegrationTestPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    mapping_sent?: string;
    receiver_saved?: string;
    service_mapping_saved?: string;
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

  const [
    { data: serviceEvents },
    { data: serviceMappings },
    { data: classTemplates },
  ] = await Promise.all([
      supabase
        .from("asistian_webhook_events")
        .select("payload,received_at")
        .eq("studio_id", studio.id)
        .order("received_at", { ascending: false })
        .limit(100),
      supabase
        .from("asistian_service_mappings")
        .select("asistian_service_id,asistian_service_name,class_template_id,active")
        .eq("studio_id", studio.id)
        .eq("active", true),
      supabase
        .from("class_templates")
        .select("id,name,active")
        .eq("studio_id", studio.id)
        .eq("active", true)
        .order("name"),
    ]);

  const observedServices = new Map<
    string,
    { id: string; name: string | null }
  >();
  for (const event of serviceEvents ?? []) {
    const payload = asRecord(event.payload);
    const data = asRecord(payload?.data);
    const service = asRecord(data?.service);
    const id = scalarText(service?.id);
    if (!id) continue;

    const name = scalarText(service?.name);
    const existing = observedServices.get(id);
    if (!existing || (!existing.name && name)) {
      observedServices.set(id, { id, name });
    }
  }

  const mappingByServiceId = new Map(
    (serviceMappings ?? []).map((mapping) => [mapping.asistian_service_id, mapping]),
  );

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

      {query.service_mapping_saved === "1" ? (
        <div className="notice success">
          Mapeo de servicio guardado. Las próximas reservas usarán el ID nativo de Asistian.
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
            <p className="eyebrow">ASISTIAN → STUDIO FLOW · SERVICIOS</p>
            <h2>Mapeo estable de actividades</h2>
            <p className="text-sm text-zinc-400">
              Vincula el ID nativo de cada servicio de Asistian con una actividad de Studio Flow.
              Una vez mapeado, el nombre puede cambiar en Asistian sin romper la sincronización.
            </p>
          </div>
        </div>

        {observedServices.size === 0 ? (
          <p className="text-sm text-zinc-400">
            Todavía no hemos observado servicios reales en los webhooks recibidos.
          </p>
        ) : (
          <div className="compact-form">
            {Array.from(observedServices.values()).map((service) => {
              const mapping = mappingByServiceId.get(service.id);
              return (
                <form
                  action={saveAsistianServiceMapping}
                  className="compact-form"
                  key={service.id}
                >
                  <input type="hidden" name="service_id" value={service.id} />
                  <input type="hidden" name="service_name" value={service.name ?? ""} />
                  <div>
                    <strong>{service.name ?? "Servicio sin nombre"}</strong>
                    <p className="text-sm text-zinc-400">
                      Asistian ID {service.id}
                      {mapping ? " · Mapeado" : " · Sin mapear"}
                    </p>
                  </div>
                  <label>
                    Actividad de Studio Flow
                    <select
                      name="class_template_id"
                      defaultValue={mapping?.class_template_id ?? ""}
                      required
                    >
                      <option value="" disabled>
                        Selecciona una actividad
                      </option>
                      {(classTemplates ?? []).map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button" type="submit">
                    {mapping ? "Actualizar mapeo" : "Guardar mapeo"}
                  </button>
                </form>
              );
            })}
          </div>
        )}
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
