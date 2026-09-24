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
  cancelled_by_studio: "Cancelada por Demeter",
};

type StudentWaitlistItem = {
  waitlist_entry_id: string;
  session_id: string;
  status: string;
  joined_at: string;
  starts_at: string;
  ends_at: string;
  activity: string;
  discipline: string;
  space: string | null;
  coach: string | null;
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

function ClassRow({ item, timezone }: { item: StudentClassFeedItem; timezone: string }) {
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

      {item.status === "cancelled_by_studio" && item.cancellation_reason ? (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-300">
              Motivo
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-300">{item.cancellation_reason}</p>
          </div>
          {item.credit_restored ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
              <p className="text-sm font-semibold text-emerald-300">✓ Clase devuelta</p>
              <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                La clase de esta reserva fue devuelta a tu paquete.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function WaitlistRow({ item, timezone }: { item: StudentWaitlistItem; timezone: string }) {
  return (
    <article className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.055] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{item.activity}</p>
            <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/[0.09] px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              En lista de espera
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-300">{formatDateTime(item.starts_at, timezone)}</p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
            {[item.coach, item.space].filter(Boolean).join(" · ") || item.discipline}
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <p className="mt-1 text-sm leading-6 text-zinc-400">Te avisaremos si se libera un lugar.</p>
      </div>
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
  const [classesResult, waitlistResult] = await Promise.all([
    supabase.rpc("student_classes_feed"),
    supabase.rpc("student_waitlist_feed"),
  ]);
  const { data, error } = classesResult;
  const waitlistItems = (waitlistResult.data ?? []) as StudentWaitlistItem[];
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
            ? "La reserva se canceló tarde y la clase no fue devuelta a tu paquete."
            : query.cancelled === "cancelled_late"
              ? "La reserva se canceló fuera del horario permitido."
              : query.credit === "returned"
                ? "La reserva se canceló correctamente y la clase fue devuelta a tu paquete."
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
          <p className="student-eyebrow">Mis clases</p>
          <h1 className="student-page-title mt-1">Tu entrenamiento</h1>
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
                <p className="student-eyebrow mb-2">Tu próxima clase</p>
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
                        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                          Confirmada
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-fuchsia-300">
                        {nextClass.discipline}
                      </p>
                      <p className="mt-1.5 text-sm text-zinc-300">
                        {formatDateTime(nextClass.starts_at, studio.timezone)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
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
                </article>
              </div>

              {followingClasses.length ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="student-eyebrow">Después</p>
                    <span className="text-xs text-zinc-500">{followingClasses.length} más</span>
                  </div>
                  <div className="space-y-2">
                    {followingClasses.map((item) => (
                      <ClassRow key={item.reservation_id} item={item} timezone={studio.timezone} />
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

          {waitlistItems.length ? (
            <div>
              <p className="student-eyebrow mb-2">Lista de espera</p>
              <div className="space-y-2">
                {waitlistItems.map((item) => (
                  <WaitlistRow
                    key={item.waitlist_entry_id}
                    item={item}
                    timezone={studio.timezone}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section>
          <p className="student-eyebrow mb-2">Clases anteriores</p>
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
