import Link from "next/link";

import { formatDateMx } from "@/lib/platform/console";
import { parseSupportRequests, SUPPORT_REQUEST_ERRORS } from "@/lib/platform/support-requests";
import { createClient } from "@/lib/supabase/server";

import { resolveSupportRequestAction } from "../actions";

// NEB-01-19 · Bandeja de solicitudes de los estudios.
export default async function PlataformaSoportePage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; estado?: string }>;
}) {
  const query = await searchParams;
  const view = query.ver === "resueltas" ? "resolved" : query.ver === "todas" ? null : "open";
  const supabase = await createClient("admin");
  const { data, error } = await supabase.rpc("platform_support_requests", { p_status: view });
  const requests = error ? null : parseSupportRequests(data);

  return (
    <>
      <section className="neb-hero">
        <p className="neb-eyebrow">Soporte</p>
        <h1>Solicitudes de los estudios</h1>
      </section>
      {query.estado === "resuelta" ? (
        <p className="neb-notice is-ok" role="status">
          Marcada como resuelta. La dueña ve tu respuesta en su panel.
        </p>
      ) : query.estado ? (
        <p className="neb-notice is-error" role="status">
          {SUPPORT_REQUEST_ERRORS[query.estado] ?? "No se pudo guardar. Intenta de nuevo."}
        </p>
      ) : null}
      <nav className="neb-tabs" aria-label="Filtro de solicitudes">
        <Link href="/plataforma/soporte" aria-current={view === "open" ? "page" : undefined}>
          Abiertas
        </Link>
        <Link
          href="/plataforma/soporte?ver=resueltas"
          aria-current={view === "resolved" ? "page" : undefined}
        >
          Resueltas
        </Link>
        <Link
          href="/plataforma/soporte?ver=todas"
          aria-current={view === null ? "page" : undefined}
        >
          Todas
        </Link>
      </nav>
      {!requests ? (
        <p className="neb-notice is-error">
          No se pudo leer la bandeja. ¿Ya está aplicada la migración de NEB-01-19?
        </p>
      ) : requests.length === 0 ? (
        <p className="neb-muted">No hay solicitudes aquí.</p>
      ) : (
        <ul className="neb-module-list">
          {requests.map((request) => (
            <li key={request.id}>
              <article className="neb-card">
                <p className="neb-eyebrow">
                  {request.studioName ?? "Estudio"} · {formatDateMx(request.createdAt)} ·{" "}
                  {request.status === "open" ? "Abierta" : "Resuelta"}
                </p>
                <h2>{request.subject}</h2>
                {request.body ? <p>{request.body}</p> : null}
                {request.studioId ? (
                  <Link
                    href={`/plataforma/estudios/${request.studioId}`}
                    className="neb-button is-ghost"
                  >
                    Ver estudio / entrar como soporte
                  </Link>
                ) : null}
                {request.status === "open" ? (
                  <form action={resolveSupportRequestAction} className="neb-form">
                    <input type="hidden" name="request" value={request.id} />
                    <label>
                      Respuesta para la dueña
                      <textarea name="response" rows={3} maxLength={2000} />
                    </label>
                    <button type="submit" className="neb-button">
                      Marcar resuelta
                    </button>
                  </form>
                ) : request.response ? (
                  <p className="neb-muted">Respuesta: {request.response}</p>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
