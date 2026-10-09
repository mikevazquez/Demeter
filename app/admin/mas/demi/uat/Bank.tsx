"use client";

import { useState } from "react";
import {
  configureDemiUatFailures,
  createDemiUatRun,
  getDemiUatRun,
  moveDemiUatSession,
  sendDemiUatMessage,
  runDemiUatNotifications,
  reviewDemiUatReceipt,
  markDemiUatAttendance,
} from "./actions";
type Data = Awaited<ReturnType<typeof getDemiUatRun>>;
const PERSONAS: Record<string, string> = {
  prospect: "Prospecto nuevo",
  prospect_existing: "Prospecto existente",
  trial_reserved: "Prueba con reserva",
  trial_cancelled: "Prueba cancelada",
  trial_no_show: "Prueba · no show",
  trial_attended: "Prueba asistida",
  trial_payment_rejected: "Prueba sin reserva · generar rechazo",
  student_active: "Alumna · paquete activo",
  student_expired_package: "Alumna · paquete vencido",
  student_cash: "Alumna · generar pago efectivo",
  former_active_package: "Exalumna · paquete activo",
  former_no_package: "Exalumna · sin paquete",
  companion: "Acompañante nueva",
};
export default function Bank({
  initialRuns,
  modelReady,
}: {
  initialRuns: { id: string; created_at: string }[];
  modelReady: boolean;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [data, setData] = useState<Data | null>(null);
  const [intentId, setIntentId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [persona, setPersona] = useState("prospect");
  const [tab, setTab] = useState("reservations");
  const [session, setSession] = useState("timely");
  const [hours, setHours] = useState(6);
  async function perform(action: () => Promise<Data>) {
    setBusy(true);
    setError("");
    try {
      setData(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }
  const outbound =
    data?.artifacts.filter(
      (a) => a.kind === "whatsapp_reply" || a.kind === "notification_delivery",
    ) ?? [];
  const inbound = data?.artifacts.filter((a) => a.kind === "after_message") ?? [];
  function exportEvidence() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `demi-uat-${data.run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <section className="uat-readiness">
        <h2>Preparación</h2>
        <div className="uat-cards">
          <article>
            <strong>Sandbox aislado</strong>
            <p>Un estudio ficticio por ejecución. Se conservan todas las evidencias.</p>
          </article>
          <article>
            <strong>{modelReady ? "Modelo configurado" : "Falta acceso al modelo"}</strong>
            <p>Se usa Demi real; no hay respuestas prefabricadas.</p>
          </article>
          <article>
            <strong>Mensajes capturados</strong>
            <p>
              Permite verificar el contenido y los fallos. La entrega externa de Meta requiere una
              prueba aparte.
            </p>
          </article>
        </div>
        <p className="uat-note">
          Este banco no aprueba casos automáticamente. Una respuesta correcta también debe dejar los
          pagos, reservas, créditos y estados esperados.
        </p>
      </section>
      <section>
        <h2>1. Preparar una ejecución</h2>
        <div className="uat-controls">
          <button
            disabled={busy || !modelReady}
            onClick={() =>
              perform(async () => {
                const result = await createDemiUatRun();
                setRuns((prev) => [
                  { id: result.run.id, created_at: result.run.created_at },
                  ...prev,
                ]);
                return result;
              })
            }
          >
            Crear escenarios aislados
          </button>
          <select
            aria-label="Ejecución"
            value={data?.run.id ?? ""}
            disabled={busy}
            onChange={(e) => e.target.value && perform(() => getDemiUatRun(e.target.value))}
          >
            <option value="">Recuperar ejecución…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.created_at).toLocaleString("es-MX")} · {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        {data && (
          <p>
            Estudio UAT: <code>{data.run.studio_id}</code> · transporte interno · historial
            conservado
          </p>
        )}
      </section>
      {error && (
        <p className="uat-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Procesando y guardando evidencia…</p>}
      {data && (
        <>
          <section>
            <h2>2. Conversar con Demi</h2>
            <form action={(form) => perform(() => sendDemiUatMessage(form))}>
              <input type="hidden" name="runId" value={data.run.id} />
              <label>
                Estado inicial
                <select name="persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
                  {Object.entries(PERSONAS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Teléfono ficticio: <code>{data.run.fixtures.people[persona]?.wa_id}</code>
              </p>
              <label>
                Mensaje
                <textarea
                  name="text"
                  rows={4}
                  placeholder="Hola, quiero reservar mi primera clase…"
                />
              </label>
              <label>
                Comprobante ficticio (imagen o PDF, máximo 4 MB)
                <input
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                />
              </label>
              <details>
                <summary>Comprobar mensaje duplicado</summary>
                <label>
                  ID del mensaje anterior
                  <input name="repeatProviderId" placeholder="uat-inbound-…" />
                </label>
              </details>
              <button disabled={busy} type="submit">
                Enviar al flujo real
              </button>
            </form>
            <div className="uat-conversation">
              {[...inbound, ...outbound]
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .map((a) => (
                  <article
                    key={a.id}
                    className={a.kind === "after_message" ? "uat-inbound" : "uat-outbound"}
                  >
                    <small>
                      {a.kind === "after_message" ? "Entrada procesada" : "Salida capturada"} ·{" "}
                      {new Date(a.created_at).toLocaleTimeString("es-MX")}
                    </small>
                    {typeof a.payload.text === "string" && <p>{a.payload.text}</p>}
                    {a.payload.failed === true && (
                      <p className="uat-error">
                        Fallo provocado · demi_uat_injected_delivery_failure
                      </p>
                    )}
                    <details>
                      <summary>Resultado técnico</summary>
                      <pre>
                        {JSON.stringify(
                          a.kind === "after_message"
                            ? {
                                provider_id: a.payload.provider_id,
                                http_status: a.payload.http_status,
                                result: a.payload.result,
                              }
                            : a.payload,
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </article>
                ))}
            </div>
          </section>
          <section>
            <h2>3. Revisar Studio Flow</h2>
            <div className="uat-controls">
              <select
                aria-label="Datos operativos"
                value={tab}
                onChange={(e) => setTab(e.target.value)}
              >
                {Object.keys(data.state).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <button disabled={busy} onClick={() => perform(() => getDemiUatRun(data.run.id))}>
                Actualizar evidencia
              </button>
              <button onClick={exportEvidence}>Descargar evidencia</button>
            </div>
            <pre className="uat-state">{JSON.stringify(data.state[tab], null, 2)}</pre>
          </section>
          <section>
            <h2>4. Controlar situaciones especiales</h2>
            <p>
              Los cambios de tiempo sólo mueven clases de esta ejecución y registran el antes y
              después.
            </p>
            <div className="uat-controls">
              <select
                aria-label="Clase"
                value={session}
                onChange={(e) => setSession(e.target.value)}
              >
                {Object.keys(data.run.fixtures.sessions).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <select
                aria-label="Tiempo antes de clase"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                {[-2, 0, 4, 5, 6, 8, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} horas desde ahora
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => perform(() => moveDemiUatSession(data.run.id, session, hours))}
              >
                Mover clase
              </button>
            </div>
            <p>Provocar fallos de entrega: se aplica a las siguientes salidas de esta ejecución.</p>
            <div className="uat-controls">
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  disabled={busy}
                  onClick={() => perform(() => configureDemiUatFailures(data.run.id, n))}
                >
                  {n === 0 ? "Sin fallo" : `${n} fallo${n > 1 ? "s" : ""}`}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>5. Ejecutar notificaciones</h2>
            <p>
              Se ejecuta el worker real, limitado al estudio ficticio. Adelantar la cola conserva la
              ventana de vencimiento y las reglas de elegibilidad.
            </p>
            <div className="uat-controls">
              <button
                disabled={busy}
                onClick={() => perform(() => runDemiUatNotifications(data.run.id, false))}
              >
                Procesar cola disponible
              </button>
              <button
                disabled={busy}
                onClick={() => perform(() => runDemiUatNotifications(data.run.id, true))}
              >
                Adelantar cola y reintentos
              </button>
            </div>
          </section>
          <section>
            <h2>6. Acciones del equipo</h2>
            <p>
              Usan las mismas funciones de validación y asistencia del estudio. Sólo aceptan
              registros de esta ejecución.
            </p>
            <label>
              ID del intento de transferencia
              <input value={intentId} onChange={(e) => setIntentId(e.target.value)} />
            </label>
            <div className="uat-controls">
              <button
                disabled={busy || !intentId}
                onClick={() =>
                  perform(() => reviewDemiUatReceipt(data.run.id, intentId, "approved"))
                }
              >
                Validar comprobante ficticio
              </button>
              <button
                disabled={busy || !intentId}
                onClick={() =>
                  perform(() => reviewDemiUatReceipt(data.run.id, intentId, "rejected"))
                }
              >
                Rechazar comprobante ficticio
              </button>
            </div>
            <label>
              ID de reserva
              <input value={reservationId} onChange={(e) => setReservationId(e.target.value)} />
            </label>
            <p>
              Para registrar asistencia, mueve la clase a 0 horas y respeta la ventana operativa.
            </p>
            <div className="uat-controls">
              <button
                disabled={busy || !reservationId}
                onClick={() =>
                  perform(() => markDemiUatAttendance(data.run.id, reservationId, "attended"))
                }
              >
                Registrar asistencia
              </button>
              <button
                disabled={busy || !reservationId}
                onClick={() =>
                  perform(() => markDemiUatAttendance(data.run.id, reservationId, "no_show"))
                }
              >
                Registrar no show
              </button>
            </div>
          </section>
          <section>
            <h2>Límites de esta preparación</h2>
            <p>
              WhatsApp externo, Instagram, Facebook, audios y pagos reales en Mercado Pago o la app
              necesitan sus cuentas e integraciones de prueba. Este banco registra fallos del
              producto; no los sustituye por resultados exitosos.
            </p>
            <details>
              <summary>Configuración de referencia</summary>
              <pre>{JSON.stringify(data.run.baseline, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
    </>
  );
}
