import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  bookingReasonCopy,
  formatDate,
  formatDateTime,
  getStudentPortalContext,
  type StudentSession,
} from "@/lib/student/portal";

import PendingActionButton from "../../../components/PendingActionButton";
import { scheduleEvaluationAction } from "../../actions";

const purchaseReasons = new Set(["no_active_product", "outside_product", "no_credits"]);

function errorCopy(value?: string) {
  const copy: Record<string, string> = {
    evaluation_invitation_not_schedulable: "Esta evaluación ya no está pendiente de programar.",
    evaluation_session_wrong_discipline: "La clase elegida no corresponde a esta disciplina.",
    evaluation_session_outside_window: "La clase elegida está fuera de la ventana de evaluación.",
    evaluation_schedule_failed: "No pudimos programar tu evaluación.",
    session_not_found: "La clase seleccionada ya no está disponible.",
    forbidden: "No puedes programar esta evaluación.",
  };
  return value ? (copy[value] ?? bookingReasonCopy(value)) : null;
}

export default async function ScheduleEvaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ invitationId: string }>;
  searchParams: Promise<{ error?: string; session?: string }>;
}) {
  const { invitationId } = await params;
  const qs = await searchParams;
  const { supabase, snapshot, studio } = await getStudentPortalContext();

  const { data: invitation } = await supabase
    .from("evaluation_invitations")
    .select(
      "id,student_id,discipline_id,discipline_level_id,invitation_kind,status,window_start,window_end,reservation_id",
    )
    .eq("id", invitationId)
    .eq("studio_id", snapshot.profile.studio_id)
    .eq("student_id", snapshot.profile.student_id)
    .maybeSingle();

  if (!invitation) notFound();

  if (invitation.status === "offered") {
    redirect("/student/evaluaciones/" + invitation.id);
  }

  if (invitation.status === "scheduled" || invitation.status === "in_progress") {
    redirect("/student/evaluaciones");
  }

  if (invitation.status !== "pending_schedule") {
    redirect("/student/evaluaciones");
  }

  const [{ data: discipline }, { data: scheduleData }] = await Promise.all([
    supabase.from("disciplines").select("name").eq("id", invitation.discipline_id).maybeSingle(),
    supabase.rpc("student_schedule_feed", {
      target_start: invitation.window_start,
      target_end: invitation.window_end,
      target_discipline_id: invitation.discipline_id,
    }),
  ]);

  const sessions = (Array.isArray(scheduleData) ? scheduleData : []) as StudentSession[];
  const selectedSession = qs.session
    ? sessions.find((session) => session.session_id === qs.session) ?? null
    : null;
  const needsPurchase = Boolean(qs.error && purchaseReasons.has(qs.error));
  const errorMessage = errorCopy(qs.error);

  return (
    <main className="space-y-5 pb-4">
      <Link
        href="/student/evaluaciones"
        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Evaluaciones
      </Link>

      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          {discipline?.name ?? "Evaluación"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
          Programar evaluación
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">
          Selecciona una clase real dentro de la ventana disponible. Tu reserva usa exactamente las
          mismas reglas, créditos y políticas que cualquier otra clase.
        </p>
      </header>

      <section className="rounded-3xl border border-fuchsia-500/25 bg-fuchsia-500/[0.055] p-4">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Ventana de evaluación
        </p>
        <strong className="mt-1 block text-sm text-white">
          Del {formatDate(invitation.window_start, studio.timezone)} al{" "}
          {formatDate(invitation.window_end, studio.timezone)}
        </strong>
      </section>

      {errorMessage ? (
        <section
          className={
            needsPurchase
              ? "rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/[0.06] p-5"
              : "rounded-3xl border border-rose-400/25 bg-rose-400/[0.06] p-5"
          }
        >
          <h2 className="text-lg font-semibold text-white">
            {needsPurchase ? "Necesitas créditos" : "No pudimos programarla"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{errorMessage}</p>

          {needsPurchase && selectedSession ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Link
                href={"/student/reservar/" + selectedSession.session_id}
                className="flex min-h-20 flex-col justify-center rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] px-4 transition hover:bg-fuchsia-500/[0.1]"
              >
                <strong className="text-sm text-white">Comprar una clase</strong>
                <span className="mt-1 text-xs text-zinc-500">
                  Reserva esta misma clase usando la opción de clase suelta.
                </span>
              </Link>
              <Link
                href="/student/paquete#catalogo-paquetes"
                className="flex min-h-20 flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.025] px-4 transition hover:border-fuchsia-500/25"
              >
                <strong className="text-sm text-white">Comprar un paquete</strong>
                <span className="mt-1 text-xs text-zinc-500">
                  Continúa tu entrenamiento y vuelve después a programar.
                </span>
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        {sessions.length ? (
          sessions.map((session) => {
            const full = session.spots_available <= 0;
            const reason = session.eligibility?.reason_code ?? null;
            const alreadyReserved = Boolean(session.is_reserved);

            return (
              <article
                key={session.session_id}
                className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                    {formatDateTime(session.starts_at, studio.timezone)}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-white">{session.activity}</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {[session.coach, session.space].filter(Boolean).join(" · ") || "Studio Flow"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                    <span>
                      {session.spots_available}/{session.capacity} lugares
                    </span>
                    <span>·</span>
                    <span>
                      {session.eligibility?.unlimited
                        ? "Incluida en ilimitado"
                        : String(session.credit_cost) +
                          " crédito" +
                          (session.credit_cost === 1 ? "" : "s")}
                    </span>
                  </div>
                </div>

                {full && !alreadyReserved ? (
                  <Link
                    href={"/student/reservar/" + session.session_id}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-amber-400/30 px-4 text-sm font-semibold text-amber-200"
                  >
                    Clase llena · Ver espera
                  </Link>
                ) : (
                  <form action={scheduleEvaluationAction}>
                    <input type="hidden" name="invitation_id" value={invitation.id} />
                    <input type="hidden" name="session_id" value={session.session_id} />
                    <PendingActionButton
                      pendingLabel="Programando…"
                      className="min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500 sm:w-auto"
                    >
                      {alreadyReserved
                        ? "Usar esta reserva"
                        : reason && !purchaseReasons.has(reason)
                          ? "Intentar reservar"
                          : "Seleccionar"}
                    </PendingActionButton>
                  </form>
                )}
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 text-center">
            <p className="text-sm font-semibold text-white">No hay clases disponibles</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              No encontramos clases de {discipline?.name ?? "esta disciplina"} dentro de esta
              ventana. Tu evaluación seguirá pendiente.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
