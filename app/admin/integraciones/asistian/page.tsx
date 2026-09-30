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
import "../integrations-v2.css";

const errorCopy: Record<string, string> = {
  invalid_url: "La URL no es válida. Debe ser una URL HTTPS de Asistian.",
  invalid_secret: "El secreto de firma no parece válido.",
  receiver_secret_invalid: "El secreto del webhook saliente de Asistian no parece válido.",
  receiver_secret_save: "No se pudo guardar el secreto para recibir eventos de Asistian.",
  service_mapping_invalid: "Selecciona un servicio de Asistian y una actividad de Studio Flow.",
  service_mapping_save: "No se pudo guardar el mapeo del servicio de Asistian.",
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

export default async function AsistianIntegrationPage({
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
  const { supabase, studio } = await getAdminContext(CAPABILITIES.INTEGRATIONS_READ);
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

  const [{ data: serviceEvents }, { data: serviceMappings }, { data: classTemplates }] =
    await Promise.all([
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

  const observedServices = new Map<string, { id: string; name: string | null }>();
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

  const processedCount = (receivedEvents ?? []).filter(
    (event) => event.processing_status === "processed",
  ).length;

  return (
    <main className="integration-detail-v2">
      <header className="integration-detail-v2-header">
        <div>
          <Link className="integration-detail-v2-back" href="/admin/integraciones">
            ← Integraciones
          </Link>
          <h1>Asistian</h1>
          <p>Configura reservas, mapeo de actividades y comunicación entre ambos sistemas.</p>
        </div>
      </header>

      {query.receiver_saved === "1" ? (
        <div className="integration-detail-v2-notice is-success">
          Conexión de entrada guardada. Ya puedes probar el webhook desde Asistian.
        </div>
      ) : null}

      {query.service_mapping_saved === "1" ? (
        <div className="integration-detail-v2-notice is-success">
          Mapeo de actividad actualizado.
        </div>
      ) : null}

      {query.mapping_sent === "1" || query.sent === "1" ? (
        <div className="integration-detail-v2-notice is-success">
          Prueba enviada{query.status ? ` · HTTP ${query.status}` : ""}.
        </div>
      ) : null}

      {query.error ? (
        <div className="integration-detail-v2-notice is-error">
          {errorCopy[query.error] ?? "No se pudo completar la operación."}
          {query.status ? ` · HTTP ${query.status}` : ""}
        </div>
      ) : null}

      <section className="integration-detail-v2-summary">
        <article>
          <span>Servicios detectados</span>
          <strong>{observedServices.size}</strong>
        </article>
        <article>
          <span>Actividades mapeadas</span>
          <strong>{serviceMappings?.length ?? 0}</strong>
        </article>
        <article>
          <span>Eventos recientes procesados</span>
          <strong>{processedCount}/{receivedEvents?.length ?? 0}</strong>
        </article>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>1. Recibir reservas desde Asistian</h2>
            <p>Conecta el webhook saliente de Asistian con este estudio.</p>
          </div>
        </div>

        <div className="integration-detail-v2-form">
          <label className="integration-detail-v2-field">
            <span>URL receptora de Studio Flow</span>
            <input type="text" readOnly value={receiverUrl} />
            <small>Copia esta URL en el webhook saliente de Asistian.</small>
          </label>

          <form action={saveAsistianToStudioReceiverSecret} className="integration-detail-v2-form">
            <label className="integration-detail-v2-field">
              <span>Secreto generado por Asistian</span>
              <input
                type="password"
                name="provider_signing_secret"
                placeholder="whsec_…"
                autoComplete="off"
                required
              />
              <small>
                Se usa para validar que los eventos realmente vienen de Asistian.
              </small>
            </label>

            <button className="integration-detail-v2-button" type="submit">
              Guardar conexión
            </button>
          </form>
        </div>
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>2. Relacionar actividades</h2>
            <p>Indica a qué actividad de Studio Flow corresponde cada servicio detectado.</p>
          </div>
        </div>

        {observedServices.size === 0 ? (
          <div className="integration-detail-v2-empty">
            Todavía no hemos recibido servicios reales desde Asistian.
          </div>
        ) : (
          <div className="integration-detail-v2-list">
            {Array.from(observedServices.values()).map((service) => {
              const mapping = mappingByServiceId.get(service.id);

              return (
                <form
                  action={saveAsistianServiceMapping}
                  className="integration-detail-v2-row"
                  key={service.id}
                >
                  <input type="hidden" name="service_id" value={service.id} />
                  <input type="hidden" name="service_name" value={service.name ?? ""} />

                  <span className="integration-detail-v2-row-copy">
                    <strong>{service.name ?? "Servicio sin nombre"}</strong>
                    <small>
                      Asistian ID {service.id}
                      {mapping ? " · Ya relacionado" : " · Pendiente"}
                    </small>
                  </span>

                  <label className="integration-detail-v2-field">
                    <span className="sr-only">Actividad de Studio Flow</span>
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

                  <button className="integration-detail-v2-button" type="submit">
                    {mapping ? "Actualizar" : "Relacionar"}
                  </button>
                </form>
              );
            })}
          </div>
        )}
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>3. Eventos recibidos</h2>
            <p>Últimos eventos enviados por Asistian para diagnóstico.</p>
          </div>
        </div>

        {!receivedEvents?.length ? (
          <div className="integration-detail-v2-empty">Todavía no hay eventos recibidos.</div>
        ) : (
          <div className="integration-detail-v2-list">
            {receivedEvents.map((event) => (
              <details key={event.id} className="integration-detail-v2-event">
                <summary>
                  {event.event_name} · {event.processing_status} ·{" "}
                  {new Date(event.received_at).toLocaleString(studio.locale, {
                    timeZone: studio.timezone,
                  })}
                </summary>
                <div>
                  <small>
                    Event ID: {event.provider_event_id}
                    {event.attempt ? ` · intento ${event.attempt}` : ""}
                  </small>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="integration-detail-v2-card">
        <div className="integration-detail-v2-card-heading">
          <div>
            <h2>Pruebas y diagnóstico</h2>
            <p>Herramientas técnicas para validar la conexión de salida hacia Asistian.</p>
          </div>
        </div>

        <details className="integration-detail-v2-event">
          <summary>Probar variables de confirmación</summary>
          <div>
            <form action={sendAsistianMappingProbe} className="integration-detail-v2-form">
              <label className="integration-detail-v2-field">
                <span>URL de prueba de Asistian</span>
                <input
                  type="url"
                  name="test_webhook_url"
                  placeholder="https://…"
                  autoComplete="off"
                  required
                />
                <small>
                  Envía un payload sintético para capturar las variables disponibles.
                </small>
              </label>
              <button className="integration-detail-v2-button" type="submit">
                Enviar prueba
              </button>
            </form>
          </div>
        </details>

        <details className="integration-detail-v2-event">
          <summary>Configurar conexión firmada de salida</summary>
          <div>
            <form action={sendAsistianHandshake} className="integration-detail-v2-form">
              <label className="integration-detail-v2-field">
                <span>URL de webhook de Asistian</span>
                <input
                  type="url"
                  name="webhook_url"
                  placeholder="https://…"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="integration-detail-v2-field">
                <span>Secreto de firma</span>
                <input
                  type="password"
                  name="signing_secret"
                  placeholder="Pega aquí el secreto"
                  autoComplete="off"
                  required
                />
              </label>
              <button className="integration-detail-v2-button" type="submit">
                Guardar y probar conexión
              </button>
            </form>
          </div>
        </details>
      </section>

      <section className="integration-detail-v2-note">
        Los datos técnicos de diagnóstico quedan aquí para no mezclarlos con la operación diaria.
      </section>
    </main>
  );
}
