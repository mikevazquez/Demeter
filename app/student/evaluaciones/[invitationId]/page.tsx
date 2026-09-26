import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

import PendingActionButton from "../../components/PendingActionButton";
import { respondEvaluationInvitationAction } from "../actions";

type InvitationDetail = {
  id: string;
  student_id: string;
  discipline_id: string;
  discipline_name: string;
  discipline_level_id: string;
  level_title: string;
  invitation_kind: "first" | "periodic";
  evaluation_purpose: "diagnostic" | "placement" | "progression" | "exception";
  status: string;
  window_start: string;
  window_end: string;
  cadence_months: number;
  reservation_id: string | null;
  offered_at: string;
  scheduled_at: string | null;
  scheduled_starts_at: string | null;
};

const errorCopy: Record<string, string> = {
  evaluation_response_invalid: "No pudimos registrar tu respuesta.",
  evaluation_response_failed: "No pudimos registrar tu respuesta. Intenta de nuevo.",
  evaluation_invitation_not_respondable: "Esta invitación ya no está pendiente de respuesta.",
  evaluation_invitation_not_found: "Esta invitación ya no está disponible.",
  forbidden: "Esta invitación no pertenece a tu cuenta.",
};

export default async function EvaluationInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ invitationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { invitationId } = await params;
  const qs = await searchParams;
  const { supabase, studio } = await getStudentPortalContext();

  const { data, error } = await supabase.rpc("student_evaluation_invitation_detail", {
    p_invitation_id: invitationId,
  });

  if (error || !data) notFound();

  const invitation = data as InvitationDetail;

  if (invitation.status === "pending_schedule") {
    redirect("/student/evaluaciones/" + invitation.id + "/programar");
  }

  return (
    <main className="space-y-5 pb-4">
      <Link
        href="/student/evaluaciones"
        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Evaluaciones
      </Link>

      <section className="overflow-hidden rounded-[28px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_80%_0%,rgba(236,72,153,0.22),transparent_34%),linear-gradient(150deg,#15101a,#0d1017)] shadow-[0_0_34px_rgba(236,72,153,0.08)]">
        <div className="p-5 sm:p-6">
          <span className="inline-flex rounded-full border border-fuchsia-500/35 bg-fuchsia-500/[0.1] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
            {invitation.evaluation_purpose === "diagnostic"
              ? "Diagnóstico inicial"
              : invitation.invitation_kind === "first"
                ? "Primera evaluación"
                : "Evaluación periódica"}
          </span>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
            {invitation.discipline_name}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">Tu próxima evaluación está lista.</p>

          <div className="mt-5 grid gap-3 rounded-3xl border border-white/10 bg-black/15 p-4">
            <div className="grid grid-cols-[34px_1fr] gap-3">
              <span className="text-xl text-fuchsia-300" aria-hidden="true">
                ▥
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  {invitation.evaluation_purpose === "diagnostic"
                    ? "Inicio del diagnóstico"
                    : "Nivel a evaluar"}
                </p>
                <strong className="mt-1 block text-sm text-white">
                  {invitation.evaluation_purpose === "diagnostic"
                    ? `Comienza en ${invitation.level_title}`
                    : invitation.level_title}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-[34px_1fr] gap-3">
              <span className="text-xl text-fuchsia-300" aria-hidden="true">
                ◫
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  Ventana disponible
                </p>
                <strong className="mt-1 block text-sm text-white">
                  Del {formatDate(invitation.window_start, studio.timezone, studio.locale)} al{" "}
                  {formatDate(invitation.window_end, studio.timezone, studio.locale)}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-[34px_1fr] gap-3">
              <span className="text-xl text-fuchsia-300" aria-hidden="true">
                ✦
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  ¿Qué se evalúa?
                </p>
                <strong className="mt-1 block text-sm leading-5 text-white">
                  {invitation.evaluation_purpose === "diagnostic"
                    ? "Comenzamos por Principiante y avanzamos nivel por nivel mientras cumplas cada evaluación."
                    : "Ponderación técnica, figuras obligatorias y requisitos definidos para tu nivel."}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-[34px_1fr] gap-3">
              <span className="text-xl text-fuchsia-300" aria-hidden="true">
                ◷
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  Cómo funciona
                </p>
                <strong className="mt-1 block text-sm text-white">
                  {invitation.evaluation_purpose === "diagnostic"
                    ? "Se detiene en el primer nivel que no cumplas y se confirma el nivel más alto que hayas demostrado."
                    : "Se realiza dentro de una clase regular que tú eliges."}
                </strong>
              </div>
            </div>
          </div>
        </div>

        {qs.error ? (
          <div className="mx-5 mb-4 rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200 sm:mx-6">
            {errorCopy[qs.error] ?? errorCopy.evaluation_response_failed}
          </div>
        ) : null}

        {invitation.status === "offered" && invitation.invitation_kind === "first" ? (
          <div className="space-y-2 border-t border-white/10 p-5 sm:p-6">
            <form action={respondEvaluationInvitationAction}>
              <input type="hidden" name="invitation_id" value={invitation.id} />
              <input type="hidden" name="response" value="accept" />
              <PendingActionButton
                pendingLabel="Aceptando…"
                className="min-h-12 w-full rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
              >
                {invitation.evaluation_purpose === "diagnostic"
                  ? "Aceptar diagnóstico"
                  : "Aceptar evaluación"}
              </PendingActionButton>
            </form>

            <form action={respondEvaluationInvitationAction}>
              <input type="hidden" name="invitation_id" value={invitation.id} />
              <input type="hidden" name="response" value="decline" />
              <PendingActionButton
                pendingLabel="Guardando…"
                className="min-h-12 w-full rounded-2xl border border-fuchsia-500/35 bg-fuchsia-500/[0.03] px-4 text-sm font-semibold text-zinc-200 transition hover:bg-fuchsia-500/[0.08]"
              >
                No por ahora
              </PendingActionButton>
            </form>
          </div>
        ) : invitation.status === "scheduled" ? (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="text-sm font-semibold text-emerald-300">
              Tu evaluación ya está programada.
            </p>
            <Link
              href="/student/evaluaciones"
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-fuchsia-600 px-4 text-sm font-semibold text-white"
            >
              Volver a Evaluaciones
            </Link>
          </div>
        ) : invitation.status === "declined" ? (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="text-sm font-semibold text-white">Elegiste no realizarla por ahora.</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              No hay penalización. El estudio puede enviarte otra invitación más adelante.
            </p>
          </div>
        ) : (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="text-sm text-zinc-400">
              Estado actual: <strong className="text-white">{invitation.status}</strong>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
