import Link from "next/link";

import {
  formatDateTime,
  getStudentPortalContext,
  type StudentClassFeedItem,
} from "@/lib/student/portal";

import { cancelStudentReservationAction } from "../actions";

const statusCopy: Record<string, string> = {
  reserved: "Reservada",
  attended: "Asististe",
  no_show: "No asististe",
  cancelled_on_time: "Cancelada a tiempo",
  cancelled_late: "Cancelada tarde",
  cancelled_by_studio: "Cancelada por el estudio",
};

const errorCopy: Record<string, string> = {
  cancel_failed: "No pudimos cancelar la reserva. Intenta de nuevo.",
  reservation_not_found: "La reserva ya no existe.",
  forbidden: "No puedes modificar esta reserva.",
  reservation_not_cancellable: "Esta reserva ya no puede cancelarse.",
};

function statusClass(status: string) {
  if (status === "attended") return "bg-emerald-500/15 text-emerald-300";
  if (status === "no_show" || status === "cancelled_late") return "bg-rose-500/15 text-rose-300";
  if (status.startsWith("cancelled")) return "bg-zinc-500/15 text-zinc-400";
  return "bg-sky-500/15 text-sky-300";
}

export default async function StudentClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; cancelled?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_classes_feed");
  const feed =
    (data as { upcoming?: StudentClassFeedItem[]; history?: StudentClassFeedItem[] } | null) ?? {};
  const upcoming = feed.upcoming ?? [];
  const history = feed.history ?? [];

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fuchsia-300">Mis clases</p>
          <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
            Tu agenda e historial
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Consulta tus próximas reservas y lo que ya ocurrió.
          </p>
        </div>
        <Link
          href="/student/reservar"
          className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
        >
          Reservar clase
        </Link>
      </header>

      {query.cancelled ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-200">
          ✓ Reserva cancelada correctamente.{" "}
          {query.cancelled === "cancelled_late"
            ? "La cancelación fue fuera de ventana y el crédito se consumió."
            : "El crédito fue liberado según la política."}
        </div>
      ) : null}
      {query.error || error ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[query.error ?? ""] ?? "No pudimos cargar o modificar tus clases."}
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-white">Próximas</h2>
        <div className="mt-4 space-y-3">
          {upcoming.length ? (
            upcoming.map((item) => (
              <article
                key={item.reservation_id}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{item.activity}</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      {formatDateTime(item.starts_at, studio.timezone)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {[item.coach, item.space].filter(Boolean).join(" · ") || item.discipline}
                    </p>
                  </div>
                  <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300">
                    Reservada
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/student/reservar/${item.session_id}`}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Ver detalle
                  </Link>
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer text-xs font-semibold text-rose-300">
                      Cancelar reserva
                    </summary>
                    <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-4">
                      <p className="text-sm text-zinc-300">
                        Si cancelas con 8 horas o más de anticipación, el crédito reservado se
                        libera. Si faltan menos de 8 horas, el motor de cancelación consume el
                        crédito según la política vigente.
                      </p>
                      <form action={cancelStudentReservationAction} className="mt-3 space-y-3">
                        <input type="hidden" name="reservation_id" value={item.reservation_id} />
                        <label className="block text-xs text-zinc-400">
                          Motivo (opcional)
                          <input
                            name="reason"
                            maxLength={250}
                            placeholder="Cuéntanos si quieres"
                            className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white"
                          />
                        </label>
                        <button
                          type="submit"
                          className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-500"
                        >
                          Sí, cancelar reserva
                        </button>
                      </form>
                    </div>
                  </details>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-7 text-center">
              <p className="text-sm text-zinc-400">No tienes reservas próximas.</p>
              <Link
                href="/student/reservar"
                className="mt-3 inline-block text-sm font-semibold text-fuchsia-300"
              >
                Buscar una clase
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-white">Historial</h2>
        <div className="mt-4 divide-y divide-white/10">
          {history.length ? (
            history.map((item) => (
              <article key={item.reservation_id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{item.activity}</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      {formatDateTime(item.starts_at, studio.timezone)}
                    </p>
                    {item.cancellation_reason ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        Motivo: {item.cancellation_reason}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(item.status)}`}
                  >
                    {statusCopy[item.status] ?? item.status}
                  </span>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-zinc-500">Todavía no tienes historial de clases.</p>
          )}
        </div>
      </section>
    </main>
  );
}
