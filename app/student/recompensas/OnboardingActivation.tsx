import Link from "next/link";

import type { StudentRewardOnboarding } from "@/lib/student/rewards";
import type { StudentUpcomingClass } from "@/lib/student/portal";
import { formatDateTime } from "@/lib/student/portal";

import { acknowledgeBronzeUnlockAction } from "./actions";

function evidenceFlag(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)[key] === true;
}

function StepRow({
  complete,
  title,
  detail,
  href,
}: {
  complete: boolean;
  title: string;
  detail: string;
  href?: string;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold " +
          (complete
            ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
            : "border-white/20 bg-white/[0.035] text-zinc-500")
        }
      >
        {complete ? "✓" : "○"}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold text-white">{title}</strong>
        <span className="mt-0.5 block text-[11px] text-zinc-500">{detail}</span>
      </span>
      {href && !complete ? (
        <span aria-hidden="true" className="text-lg text-fuchsia-300">
          ›
        </span>
      ) : null}
    </>
  );

  if (href && !complete) {
    return (
      <Link
        href={href}
        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/15 px-3.5 py-3 transition hover:border-fuchsia-500/30 hover:bg-white/[0.035]"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/15 px-3.5 py-3">
      {content}
    </div>
  );
}

export function RewardsOnboardingActivation({
  onboarding,
  upcomingClass,
  timeZone,
}: {
  onboarding: StudentRewardOnboarding;
  upcomingClass: StudentUpcomingClass | null;
  timeZone: string;
}) {
  const documentsComplete = Boolean(onboarding.documents_completed_at);
  const profileComplete = Boolean(onboarding.profile_completed_at);
  const reservationComplete = Boolean(onboarding.first_reservation_at);
  const attendanceComplete = Boolean(onboarding.first_attendance_at);
  const completed = [
    documentsComplete,
    profileComplete,
    reservationComplete,
    attendanceComplete,
  ].filter(Boolean).length;
  const percent = completed * 25;

  const emailReady = evidenceFlag(onboarding.profile_evidence, "email");
  const avatarReady = evidenceFlag(onboarding.profile_evidence, "avatar");
  const birthDateReady = evidenceFlag(onboarding.profile_evidence, "birth_date");

  return (
    <main className="space-y-4 pb-5">
      <header className="pt-1 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Recompensas
        </p>
        <h1 className="mx-auto mt-2 max-w-sm text-3xl font-semibold tracking-tight text-white">
          Desbloquea tu primera <span className="text-fuchsia-400">medalla</span>
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-5 text-zinc-400">
          Completa estos pasos para activar Rewards y obtener tu Medalla Bronce.
        </p>
      </header>

      <section className="rounded-[28px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_85%_0%,rgba(236,72,153,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] p-4 shadow-[0_0_32px_rgba(236,72,153,0.07)] sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm text-white">{completed} de 4 completados</strong>
          <span className="text-xs font-semibold text-fuchsia-300">{percent}%</span>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Progreso de activación"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-400"
            style={{ width: percent + "%" }}
          />
        </div>

        <div className="mt-4 rounded-3xl border border-[#CD7F32]/35 bg-[radial-gradient(circle_at_15%_0%,rgba(205,127,50,0.18),transparent_38%),rgba(0,0,0,0.2)] p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#CD7F32]/70 bg-[#CD7F32]/10 text-2xl font-bold text-[#E6A56A] shadow-[0_0_24px_rgba(205,127,50,0.18)]"
            >
              D
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#E6A56A]">
                Tu primera medalla
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">Medalla Bronce</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Completa tu activación para acceder a sus beneficios.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <StepRow
            complete={documentsComplete}
            title="Acepta tus documentos"
            detail={documentsComplete ? "Listo" : "Revisa y acepta los documentos obligatorios"}
            href="/student/documentos"
          />
          <StepRow
            complete={profileComplete}
            title="Completa tu perfil"
            detail={
              profileComplete
                ? "Listo"
                : [
                    emailReady ? null : "correo",
                    avatarReady ? null : "foto",
                    birthDateReady ? null : "fecha de nacimiento",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Completa tus datos"
            }
            href="/student/perfil?edit=1"
          />
          <StepRow
            complete={reservationComplete}
            title="Reserva tu primera clase"
            detail={reservationComplete ? "Listo" : "Elige una clase y confirma tu reserva"}
            href="/student/reservar"
          />
          <StepRow
            complete={attendanceComplete}
            title="Asiste a tu primera clase"
            detail={
              attendanceComplete
                ? "Listo"
                : upcomingClass
                  ? `${upcomingClass.activity} · ${formatDateTime(upcomingClass.starts_at, timeZone)}`
                  : reservationComplete
                    ? "Tu primera asistencia desbloqueará este paso"
                    : "Primero reserva una clase"
            }
          />
        </div>
      </section>

      <p className="text-center text-xs italic text-zinc-600">
        Grandes cosas comienzan con un primer paso.
      </p>
    </main>
  );
}

export function BronzeMedalUnlocked() {
  return (
    <main className="pb-5">
      <section className="relative overflow-hidden rounded-[30px] border border-fuchsia-500/40 bg-[radial-gradient(circle_at_50%_18%,rgba(236,72,153,0.28),transparent_30%),radial-gradient(circle_at_50%_22%,rgba(205,127,50,0.2),transparent_42%),rgba(255,255,255,0.025)] px-5 py-9 text-center shadow-[0_0_36px_rgba(236,72,153,0.1)]">
        <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-[3px] border-[#CD7F32]/80 bg-[#CD7F32]/15 text-5xl font-bold text-[#E6A56A] shadow-[0_0_42px_rgba(236,72,153,0.28)]">
          D
        </div>
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          Medalla Bronce
        </p>
        <h1 className="mx-auto mt-2 max-w-md text-3xl font-semibold tracking-tight text-white">
          ¡Desbloqueaste tu primera medalla!
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-300">
          Completaste tu activación en Demeter. Ya tienes acceso a los beneficios de tu Medalla Bronce.
        </p>

        <div className="mx-auto mt-6 max-w-md rounded-3xl border border-white/10 bg-black/25 p-4 text-left">
          <p className="text-xs font-semibold text-white">Tus beneficios ya están activos</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            Desde ahora Rewards reconocerá tu constancia y podrás avanzar hacia nuevas medallas.
          </p>
        </div>

        <form action={acknowledgeBronzeUnlockAction} className="mx-auto mt-6 max-w-md">
          <button
            type="submit"
            className="min-h-12 w-full rounded-2xl bg-fuchsia-600 px-5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver mis beneficios
          </button>
        </form>
      </section>
    </main>
  );
}
