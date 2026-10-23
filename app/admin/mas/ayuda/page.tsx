import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { loadStudioFeatureFlags } from "@/lib/platform/features";
import { SUPPORT_REQUEST_ERRORS, parseSupportRequests } from "@/lib/platform/support-requests";

import "../../configuracion/reservas/reservas-v2.css";
import "./ayuda.css";
import { createSupportRequestAction } from "./actions";

// NEB-01-19 · Ayuda de Nébora: pedir soporte y ver las respuestas.
export default async function SupportHelpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; enviada?: string }>;
}) {
  const [query, ctx] = await Promise.all([searchParams, getAdminContext()]);
  if (!ctx.can(CAPABILITIES.SETTINGS_WRITE)) redirect("/admin?error=access");
  // NEB-01-20 · solo donde la función ya está lanzada.
  if (!(await loadStudioFeatureFlags(ctx.supabase, ctx.studio.id)).has("support_requests")) redirect("/admin/mas");
  const { data, error } = await ctx.supabase.rpc("studio_support_requests", {
    p_studio: ctx.studio.id,
  });
  const requests = error ? [] : parseSupportRequests(data);
  const when = (value: string) =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: ctx.studio.timezone,
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  return (
    <main className="reservations-v2">
      <header className="reservations-v2-header">
        <Link href="/admin/mas" className="reservations-v2-back">
          ← Más
        </Link>
        <h1>Ayuda de Nébora</h1>
        <p>Cuéntanos qué necesitas. Te respondemos aquí mismo.</p>
      </header>

      {query.enviada ? (
        <div className="reservations-v2-notice is-success">
          Recibimos tu solicitud. Te avisamos aquí cuando quede resuelta.
        </div>
      ) : null}
      {query.error ? (
        <div className="reservations-v2-notice is-error">
          {SUPPORT_REQUEST_ERRORS[query.error] ?? "No pudimos enviar tu solicitud. Intenta de nuevo."}
        </div>
      ) : null}

      <section className="reservations-v2-card">
        <form action={createSupportRequestAction} className="help-form">
          <label>
            <span>Asunto</span>
            <input name="subject" required minLength={3} maxLength={120} placeholder="Ej. No puedo cambiar un precio" />
          </label>
          <label>
            <span>Detalle (opcional)</span>
            <textarea name="body" rows={4} maxLength={2000} placeholder="Qué intentabas hacer y qué pasó" />
          </label>
          <button type="submit">Enviar a Nébora</button>
        </form>
      </section>

      <section className="reservations-v2-card">
        <h2>Tus solicitudes</h2>
        {requests.length ? (
          <ul className="help-list">
            {requests.map((request) => (
              <li key={request.id} className={`help-item is-${request.status}`}>
                <div>
                  <span className="help-badge">{request.status === "open" ? "Abierta" : "Resuelta"}</span>
                  <strong>{request.subject}</strong>
                  <small>{when(request.createdAt)}</small>
                  {request.response ? <p className="help-response">Respuesta: {request.response}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>Todavía no has pedido ayuda.</p>
        )}
      </section>
    </main>
  );
}
