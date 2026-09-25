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
  evaluation_invitation_not_respondable: "Esta evaluación ya no está pendiente de respuesta.",
  evaluation_invitation_not_found: "Esta evaluación ya no está disponible.",
  forbidden: "Esta evaluación no pertenece a tu cuenta.",
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
  const diagnostic = invitation.evaluation_purpose === "diagnostic";

  if (invitation.status === "pending_schedule") {
    redirect("/student/evaluaciones/" + invitation.id + "/programar");
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 pb-4">
      <Link
        href="/student/evaluaciones"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
      >
        <span aria-hidden="true">←</span>
        Nivel técnico
      </Link>

      <section className="student-card overflow-hidden">
        <div className="p-5 sm:p-6">
          <p className="student-eyebrow">{invitation.discipline_name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {diagnostic ? "Descubre tu nivel técnico" : "Tu próxima evaluación está disponible"}
          </h1>

          {diagnostic ? (
            <>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Vamos a evaluar tus habilidades empezando desde {invitation.level_title}. Si
                completas ese nivel, continuaremos con el siguiente.
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">
                Al terminar te asignaremos el nivel más alto que hayas demostrado.
              </p>
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Tu nivel técnico es independiente de tus medallas y beneficios.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Ya puedes realizar tu siguiente evaluación de {invitation.discipline_name}.
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                Puedes elegir una clase entre el{" "}
                <strong className="font-semibold text-white">
                  {formatDate(invitation.window_start, studio.timezone)}
                </strong>{" "}
                y el{" "}
                <strong className="font-semibold text-white">
                  {formatDate(invitation.window_end, studio.timezone)}
                </strong>
                .
              </p>
            </>
          )}

          {diagnostic ? (
            <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
              <p className="text-sm font-semibold text-white">¿Cómo funciona?</p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Avanzaremos nivel por nivel mientras cumplas cada evaluación y nos detendremos en el
                primero que todavía necesites consolidar.
              </p>
            </div>
          ) : null}

          {qs.error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-sm leading-6 text-rose-200">
              {errorCopy[qs.error] ?? errorCopy.evaluation_response_failed}
            </div>
          ) : null}
        </div>

        {invitation.status === "offered" ? (
          <div className="space-y-2 border-t border-white/10 p-5 sm:p-6">
            <form action={respondEvaluationInvitationAction}>
              <input type="hidden" name="invitation_id" value={invitation.id} />
              <input type="hidden" name="response" value="accept" />
              <PendingActionButton
                pendingLabel="Continuando…"
                className="student-action-primary w-full"
              >
                {diagnostic ? "Comenzar diagnóstico" : "Elegir mi clase"}
              </PendingActionButton>
            </form>

            {invitation.invitation_kind === "first" ? (
              <form action={respondEvaluationInvitationAction}>
                <input type="hidden" name="invitation_id" value={invitation.id} />
                <input type="hidden" name="response" value="decline" />
                <PendingActionButton
                  pendingLabel="Guardando…"
                  className="student-action-secondary w-full"
                >
                  No por ahora
                </PendingActionButton>
              </form>
            ) : null}
          </div>
        ) : invitation.status === "scheduled" ? (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="text-sm font-semibold text-emerald-300">
              Tu evaluación ya está programada.
            </p>
            <Link href="/student/evaluaciones" className="student-action-secondary mt-3 w-full">
              Volver a Nivel técnico
            </Link>
          </div>
        ) : invitation.status === "declined" ? (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="text-sm font-semibold text-white">La dejaste para después.</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              No hay penalización. Demeter podrá ofrecerte otra evaluación más adelante.
            </p>
          </div>
        ) : (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="text-sm text-zinc-400">
              Esta evaluación ya no requiere una respuesta de tu parte.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
