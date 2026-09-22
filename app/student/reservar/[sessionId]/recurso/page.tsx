import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  formatDateTime,
  getStudentPortalContext,
  localDateKey,
  type StudentSession,
} from "@/lib/student/portal";

import ResourcePicker, {
  type StudentMapElement,
  type StudentResourceChoice,
} from "./ResourcePicker";

type ResourceMapPayload = {
  session_id: string;
  requires_resource: boolean;
  default_uses: number;
  map: {
    space_id: string;
    canvas_width: number;
    canvas_height: number;
    revision: number;
  } | null;
  resources: StudentResourceChoice[];
  elements: StudentMapElement[];
};

const resourceErrorCopy: Record<string, string> = {
  resource_required: "Selecciona un recurso antes de confirmar tu reserva.",
  resource_full: "Ese recurso acaba de llenarse. Elige otro disponible.",
  resource_not_available: "Ese recurso ya no está disponible. Elige otro.",
};

export default async function StudentResourceSelectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();

  const [{ data: sessionData, error: sessionError }, { data: resourceData, error: resourceError }] =
    await Promise.all([
      supabase.rpc("student_session_detail", { target_session_id: sessionId }),
      supabase.rpc("student_session_resource_map", { target_session_id: sessionId }),
    ]);

  if (sessionError || resourceError || !sessionData || !resourceData) {
    notFound();
  }

  const session = sessionData as StudentSession;
  const resourceMap = resourceData as ResourceMapPayload;

  if (!session.requires_resource || !resourceMap.requires_resource) {
    redirect(`/student/reservar/${sessionId}/confirmar`);
  }

  if (session.reservation_id) {
    redirect("/student/mis-clases");
  }

  if (!session.eligibility?.eligible) {
    redirect(`/student/reservar/${sessionId}`);
  }

  const sessionDate = localDateKey(new Date(session.starts_at), studio.timezone);
  const returnDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : sessionDate;
  const selectableCount = resourceMap.resources.filter(
    (resource) => resource.enabled && resource.available > 0,
  ).length;

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href={`/student/reservar/${sessionId}?date=${returnDate}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-fuchsia-300"
      >
        <span aria-hidden="true">←</span>
        Volver al detalle
      </Link>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
          Selección de recurso
        </p>
        <h1 className="mt-1 text-xl font-semibold text-white">{session.activity}</h1>
        <p className="mt-1.5 text-xs text-zinc-400">
          {formatDateTime(session.starts_at, studio.timezone)}
          {session.space ? ` · ${session.space}` : ""}
        </p>
      </section>

      {query.error ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4"
        >
          <p className="text-sm font-semibold text-amber-100">Actualizamos la disponibilidad</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {resourceErrorCopy[query.error] ?? "Elige nuevamente un recurso disponible."}
          </p>
        </div>
      ) : null}

      {!resourceMap.map || !resourceMap.elements.length ? (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          <p className="text-sm font-semibold text-amber-100">El mapa todavía no está disponible</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Esta clase requiere un recurso, pero su espacio aún no tiene una distribución publicada.
            El estudio debe configurarla antes de aceptar esta reserva.
          </p>
        </section>
      ) : selectableCount === 0 ? (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          <p className="text-sm font-semibold text-amber-100">No quedan recursos disponibles</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            La clase todavía puede mostrar lugares generales, pero todos los recursos habilitados ya
            están ocupados.
          </p>
        </section>
      ) : (
        <ResourcePicker
          sessionId={sessionId}
          returnDate={returnDate}
          resources={resourceMap.resources}
          elements={resourceMap.elements}
        />
      )}
    </main>
  );
}
