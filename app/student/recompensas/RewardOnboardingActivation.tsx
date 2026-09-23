import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";

type Requirement = {
  completed?: boolean;
  completed_at?: string | null;
};

export type RewardOnboardingSnapshot = {
  status?: "in_progress" | "medal_unlocked";
  completed_count?: number;
  total_steps?: number;
  medal_unlocked?: boolean;
  medal_key?: string | null;
  medal_title?: string | null;
  bronze_unlocked_at?: string | null;
  unlock_method?: "onboarding" | "admin" | "legacy" | null;
  documents?: Requirement & { evidence?: Record<string, unknown> };
  profile?: Requirement & {
    email?: boolean;
    avatar?: boolean;
    birth_date?: boolean;
    birth_date_value?: string | null;
  };
  first_booking?: Requirement;
  first_attendance?: Requirement;
};

type UpcomingClass = {
  starts_at: string;
  activity: string;
  discipline: string;
  space: string | null;
};

function StepIcon({ completed }: { completed: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold " +
        (completed
          ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
          : "border-white/20 bg-white/[0.025] text-zinc-500")
      }
    >
      {completed ? "✓" : "○"}
    </span>
  );
}

function ActivationStep({
  completed,
  title,
  detail,
  href,
  action,
}: {
  completed: boolean;
  title: string;
  detail: string;
  href?: string;
  action?: string;
}) {
  const body = (
    <div className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-3.5 py-3 transition">
      <StepIcon completed={completed} />
      <div className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold text-white">{title}</strong>
        <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">
          {completed ? "Listo" : detail}
        </span>
      </div>
      {!completed && action ? (
        <span className="shrink-0 text-[11px] font-semibold text-fuchsia-300">{action} →</span>
      ) : completed ? (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
          Hecho
        </span>
      ) : null}
    </div>
  );

  if (!completed && href) {
    return (
      <Link href={href} className="block hover:[&>div]:border-fuchsia-500/35 hover:[&>div]:bg-fuchsia-500/[0.045]">
        {body}
      </Link>
    );
  }

  return body;
}

export default function RewardOnboardingActivation({
  onboarding,
  nextClass,
  timeZone,
}: {
  onboarding: RewardOnboardingSnapshot;
  nextClass: UpcomingClass | null;
  timeZone: string;
}) {
  const completed = Math.max(0, Math.min(4, Number(onboarding.completed_count ?? 0)));
  const percent = Math.round((completed / 4) * 100);
  const documentsDone = onboarding.documents?.completed === true;
  const profileDone = onboarding.profile?.completed === true;
  const bookingDone = onboarding.first_booking?.completed === true;
  const attendanceDone = onboarding.first_attendance?.completed === true;

  return (
    <main className="space-y-4 pb-5">
      <header className="text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Rewards
        </p>
        <h1 className="mx-auto mt-2 max-w-sm text-3xl font-semibold tracking-tight text-white">
          Desbloquea tu primera <span className="text-fuchsia-400">medalla</span>
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-5 text-zinc-400">
          Completa estos pasos para desbloquear tu Medalla Bronce y acceder a sus beneficios.
        </p>
      </header>

      <section className="rounded-[28px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_50%_0%,rgba(236,72,153,0.14),transparent_34%),rgba(255,255,255,0.025)] p-4 shadow-[0_0_34px_rgba(236,72,153,0.08)] sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-white">{completed} de 4 completados</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Tu activación se guarda automáticamente.</p>
          </div>
          <strong className="text-sm text-fuchsia-300">{percent}%</strong>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Progreso de activación"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span
            className="block h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-400"
            style={{ width: percent + "%" }}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-[22px] border border-[#CD7F32]/45 bg-[radial-gradient(circle_at_14%_50%,rgba(205,127,50,0.18),transparent_34%),rgba(0,0,0,0.24)] p-4">
          <div className="flex items-center gap-4">
            <div
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-[#CD7F32]/75 bg-[#CD7F32]/10 text-3xl shadow-[0_0_28px_rgba(205,127,50,0.2)]"
            >
              🥉
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#DFA267]">
                Tu primera medalla
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">Medalla Bronce</h2>
              <p className="mt-1 text-xs leading-4 text-zinc-400">
                Completa tu activación para empezar a disfrutar sus beneficios.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <ActivationStep
            completed={documentsDone}
            title="Acepta tus documentos"
            detail="Revisa y acepta los documentos obligatorios."
            href="/student/documentos"
            action="Revisar"
          />
          <ActivationStep
            completed={profileDone}
            title="Completa tu perfil"
            detail="Foto, fecha de nacimiento y correo válido."
            href="/student/perfil?onboarding=1"
            action="Completar"
          />
          <ActivationStep
            completed={bookingDone}
            title="Reserva tu primera clase"
            detail="Haz una reserva confirmada desde la agenda."
            href="/student/reservar"
            action="Reservar"
          />
          <ActivationStep
            completed={attendanceDone}
            title="Asiste a tu primera clase"
            detail={bookingDone ? "Tu primera asistencia desbloquea este paso." : "Primero reserva una clase."}
          />
        </div>

        {bookingDone && !attendanceDone && nextClass ? (
          <Link
            href="/student/mis-clases"
            className="mt-3 block rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.055] p-3.5 transition hover:bg-emerald-400/[0.08]"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              Tu próxima clase
            </p>
            <strong className="mt-1 block text-sm text-white">{nextClass.activity}</strong>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              {formatDateTime(nextClass.starts_at, timeZone)}
              {nextClass.space ? " · " + nextClass.space : ""}
            </span>
            <span className="mt-2 block text-[11px] font-semibold text-emerald-300">
              Asiste para completar el último paso →
            </span>
          </Link>
        ) : null}
      </section>

      <aside className="rounded-2xl border border-fuchsia-500/15 bg-fuchsia-500/[0.04] px-4 py-3 text-center">
        <p className="text-[11px] leading-5 text-zinc-400">
          <strong className="text-zinc-200">Medallas y niveles técnicos son cosas distintas.</strong>{" "}
          Tu medalla pertenece a Rewards; tu nivel técnico se evalúa por disciplina.
        </p>
      </aside>
    </main>
  );
}
