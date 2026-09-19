import Link from "next/link";

import {
  formatDateTime,
  getStudentPortalContext,
  type StudentClassFeedItem,
} from "@/lib/student/portal";

import StudentNoticeDialog from "../components/StudentNoticeDialog";

const statusCopy: Record<string, string> = {
  reserved: "Reservada",
  attended: "Asististe",
  no_show: "No asististe",
  cancelled_on_time: "Cancelada",
  cancelled_late: "Cancelada",
  cancelled_by_studio: "Cancelada por el estudio",
};

const errorCopy: Record<string, string> = {
  cancel_failed: "No pudimos cancelar la reserva. Intenta de nuevo.",
  reservation_not_found: "La reserva ya no existe.",
  forbidden: "No puedes modificar esta reserva.",
  reservation_not_cancellable: "La reserva ya cambió de estado.",
  reservation_required: "No pudimos identificar la reserva.",
};

function statusClass(status: string) {
  if (status === "attended") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (status === "no_show") return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  if (status.startsWith("cancelled")) {
    return "border-zinc-500/25 bg-zinc-500/10 text-zinc-400";
  }
  return "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-200";
}

function ClassRow({
  item,
  timezone,
  showQuickCancel = false,
}: {
  item: StudentClassFeedItem;
  timezone: string;
  showQuickCancel?: boolean;
}) {
  return (
    <article
      data-density="compact"
      className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 transition hover:bg-white/[0.05]"
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <Link href={`/student/mis-clases/${item.reservation_id}`} className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{item.activity}</p>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}
            >
              {statusCopy[item.status] ?? item.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-300">{formatDateTime(item.starts_at, timezone)}</p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
            {[item.coach, item.space].filter(Boolean).join(" · ") || item.discipline}
          </p>
        </Link>

        <Link
          href={`/student/mis-clases/${item.reservation_id}`}
          aria-label={`Ver detalles de ${item.activity}`}
          className="text-xl text-zinc-500"
        >
          ›
        </Link>
      </div>

      {showQuickCancel && item.status === "reserved" ? (
        <div className="mt-3 flex justify-end border-t border-white/10 pt-3">
          <Link
            href={`/student/mis-clases/${item.reservation_id}/cancelar`}
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/[0.12]"
          >
            Cancelar
          </Link>
        </div>
      ) : null}
    </article>
  );
}

export default async function StudentClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    error?: string;
    cancelled?: string;
    credit?: string;
  }>;
}) {
  const query = await searchParams;
  const activeView = query.view === "history" ? "history" : "upcoming";
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_classes_feed");
  const feed =
    (data as {
      upcoming?: StudentClassFeedItem[];
      history?: StudentClassFeedItem[];
    } | null) ?? {};
  const upcoming = feed.upcoming ?? [];
  const history = feed.history ?? [];
  const nextClass = upcoming[0] ?? null;
  const followingClasses = upcoming.slice(1);

  return (
    <main className="space-y-4 pb-4">
      {query.cancelled ? (
        <StudentNoticeDialog
          eyebrow="Reserva cancelada"
          title="Tu reserva fue actualizada"
          dismissHref="/student/mis-clases"
        >
          {query.cancelled === "cancelled_late" && query.credit === "lost"
            ? "La reserva se canceló fuera del horario permitido. El crédito no fue devuelto."
            : query.cancelled === "cancelled_late"
              ? "La reserva se canceló fuera del horario permitido."
              : query.credit === "returned"
                ? "La reserva se canceló correctamente y el crédito fue devuelto."
                : "La reserva se canceló correctamente."}
        </StudentNoticeDialog>
      ) : query.error ? (
        <StudentNoticeDialog
          eyebrow="No pudimos cancelar"
          title={
            query.error === "reservation_not_cancellable"
              ? "La reserva ya cambió de estado"
              : "Revisa tu reserva"
          }
          dismissHref="/student/mis-clases"
          tone="error"
        >
          {errorCopy[query.error] ?? errorCopy.cancel_failed}
        </StudentNoticeDialog>
      ) : null}

      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            Portal alumna
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Mis clases</h1>
        </div>
        <Link
          href="/student/reservar"
          className="rounded-xl bg-fuchsia-600 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-fuchsia-500"
        >
          Reservar
        </Link>
      </header>

      <nav
        aria-label="Vista de mis clases"
        className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1"
      >
        <Link
          href="/student/mis-clases"
          aria-current={activeView === "upcoming" ? "page" : undefined}
          className={`rounded-xl px-4 py-2.5 text-center text-xs font-semibold transition ${
            activeView === "upcoming"
              ? "bg-fuchsia-600 text-white"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          Próximas{upcoming.length ? ` (${upcoming.length})` : ""}
        </Link>
        <Link
          href="/student/mis-clases?view=history"
          aria-current={activeView === "history" ? "page" : undefined}
          className={`rounded-xl px-4 py-2.5 text-center text-xs font-semibold transition ${
            activeView === "history"
              ? "bg-fuchsia-600 text-white"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          Historial
        </Link>
      </nav>

      {error ? (
        <section className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.07] p-5 text-center">
          <h2 className="text-base font-semibold text-white">No pudimos cargar tus clases</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Intenta nuevamente. Tus reservas no se han modificado.
          </p>
          <Link
            href="/student/mis-clases"
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Reintentar
          </Link>
        </section>
      ) : activeView === "upcoming" ? (
        <section className="space-y-3">
          {nextClass ? (
            <>
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Tu próxima clase
                </p>
                <article
                  data-density="compact"
                  className="rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/[0.1] via-white/[0.035] to-transparent px-4 py-4"
                >
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <Link
                      href={`/student/mis-clases/${nextClass.reservation_id}`}
                      className="min-w-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-white">
                          {nextClass.activity}
                        </h2>
                        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Confirmada
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-fuchsia-300">
                        {nextClass.discipline}
                      </p>
                      <p className="mt-1.5 text-xs text-zinc-300">
                        {formatDateTime(nextClass.starts_at, studio.timezone)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {[nextClass.coach, nextClass.space].filter(Boolean).join(" · ") ||
                          "Ver detalles de la clase"}
                      </p>
                    </Link>
                    <Link
                      href={`/student/mis-clases/${nextClass.reservation_id}`}
                      aria-label={`Ver detalles de ${nextClass.activity}`}
                      className="text-xl text-zinc-500"
                    >
                      ›
                    </Link>
                  </div>

                  <div className="mt-3 flex justify-end border-t border-white/10 pt-3">
                    <Link
                      href={`/student/mis-clases/${nextClass.reservation_id}/cancelar`}
                      className="inline-flex min-h-9 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/[0.12]"
                    >
                      Cancelar
                    </Link>
                  </div>
                </article>
              </div>

              {followingClasses.length ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Después
                    </p>
                    <span className="text-[10px] text-zinc-600">{followingClasses.length} más</span>
                  </div>
                  <div className="space-y-2">
                    {followingClasses.map((item) => (
                      <ClassRow
                        key={item.reservation_id}
                        item={item}
                        timezone={studio.timezone}
                        showQuickCancel
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
              <div
                aria-hidden="true"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-lg text-zinc-500"
              >
                ◫
              </div>
              <h2 className="mt-3 text-base font-semibold text-white">No tienes clases próximas</h2>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-zinc-400">
                Cuando reserves una clase aparecerá aquí.
              </p>
              <Link
                href="/student/reservar"
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Reservar clase
              </Link>
            </div>
          )}
        </section>
      ) : (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Clases anteriores
          </p>
          {history.length ? (
            <div className="space-y-2">
              {history.map((item) => (
                <ClassRow key={item.reservation_id} item={item} timezone={studio.timezone} />
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
              <h2 className="text-base font-semibold text-white">Todavía no tienes historial</h2>
              <p className="mt-1.5 text-xs text-zinc-400">Tus clases anteriores aparecerán aquí.</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
