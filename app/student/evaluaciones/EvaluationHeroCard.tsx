type EvaluationHeroVariant = "diagnostic_completed" | "level_up" | "level_maintained" | "scheduled";

type EvaluationHeroCardProps = {
  variant: EvaluationHeroVariant;
  disciplineName: string;
  levelName?: string | null;
  scheduledLabel?: string | null;
};

const heroCopy: Record<
  EvaluationHeroVariant,
  {
    eyebrow: string;
    title: string;
    support: string;
    badge: string;
    badgeTone: "gold" | "pink";
  }
> = {
  diagnostic_completed: {
    eyebrow: "Nivel confirmado",
    title: "Tu diagnóstico inicial ha finalizado.",
    support: "Tu punto de partida técnico ya está confirmado.",
    badge: "✓ Diagnóstico completado",
    badgeTone: "gold",
  },
  level_up: {
    eyebrow: "¡Subiste de nivel!",
    title: "Tu progreso técnico sigue avanzando.",
    support: "Tu constancia y técnica ya se reflejan en un nuevo nivel.",
    badge: "✓ Progresión aprobada",
    badgeTone: "gold",
  },
  level_maintained: {
    eyebrow: "Nivel actual confirmado",
    title: "Sigues construyendo una base sólida.",
    support: "Mantener el nivel también es parte del progreso técnico.",
    badge: "Permanece en su nivel",
    badgeTone: "pink",
  },
  scheduled: {
    eyebrow: "Próxima evaluación",
    title: "Tu siguiente revisión técnica ya está agendada.",
    support: "Prepárate para mostrar tu progreso.",
    badge: "Programada",
    badgeTone: "pink",
  },
};

export default function EvaluationHeroCard({
  variant,
  disciplineName,
  levelName,
  scheduledLabel,
}: EvaluationHeroCardProps) {
  const copy = heroCopy[variant];
  const primary =
    variant === "scheduled"
      ? (scheduledLabel ?? "Evaluación programada")
      : variant === "level_up"
        ? `Nuevo nivel: ${levelName ?? "Nivel técnico"}`
        : (levelName ?? "Nivel técnico");

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-fuchsia-500/35 bg-[linear-gradient(135deg,#250919_0%,#140813_42%,#090d13_100%)] shadow-[0_0_34px_rgba(236,72,153,0.10)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_28%,rgba(236,72,153,0.34),transparent_27%),radial-gradient(circle_at_94%_5%,rgba(168,85,247,0.16),transparent_28%)]" />
      <div className="absolute inset-y-0 right-[27%] w-px bg-gradient-to-b from-transparent via-fuchsia-400/75 to-transparent shadow-[0_0_16px_rgba(236,72,153,0.65)]" />

      <div
        className="pointer-events-none absolute right-2 top-3 h-[190px] w-[145px] opacity-75 sm:right-10 sm:top-4 sm:h-[210px] sm:w-[165px]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 165 210" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="evalBodyGlow" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(244,114,182,0.38)" />
              <stop offset="100%" stopColor="rgba(168,85,247,0.04)" />
            </linearGradient>
            <filter id="evalGlow">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <line
            x1="128"
            y1="-8"
            x2="128"
            y2="220"
            stroke="rgba(244,114,182,0.68)"
            strokeWidth="2"
            filter="url(#evalGlow)"
          />
          <circle
            cx="88"
            cy="48"
            r="13"
            fill="rgba(244,114,182,0.18)"
            stroke="rgba(244,114,182,0.48)"
            strokeWidth="1.5"
          />
          <path
            d="M82 61 C72 82, 76 108, 91 125 C103 138, 109 155, 107 182 C92 171, 82 158, 76 145 C68 127, 55 115, 43 103 C60 96, 69 89, 74 74 Z"
            fill="url(#evalBodyGlow)"
            stroke="rgba(244,114,182,0.42)"
            strokeWidth="1.4"
          />
          <path
            d="M94 66 C108 62, 117 47, 125 28"
            fill="none"
            stroke="rgba(244,114,182,0.55)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M87 75 C100 83, 113 89, 127 92"
            fill="none"
            stroke="rgba(244,114,182,0.35)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M77 132 C61 148, 48 165, 36 191"
            fill="none"
            stroke="rgba(244,114,182,0.32)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M101 127 C115 145, 124 163, 130 190"
            fill="none"
            stroke="rgba(244,114,182,0.34)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M74 52 C65 45, 63 34, 69 26 C70 38, 77 41, 88 41"
            fill="none"
            stroke="rgba(244,114,182,0.35)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="relative grid min-h-[220px] grid-cols-[minmax(0,1fr)_88px] gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_150px] sm:p-7">
        <div className="flex min-w-0 flex-col justify-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            {disciplineName}
          </p>
          <p className="mt-3 text-base font-semibold text-zinc-100">{copy.eyebrow}</p>
          <h1 className="mt-1 text-[clamp(2rem,9vw,3.5rem)] font-semibold leading-[0.98] tracking-tight text-white">
            {primary}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-300">{copy.title}</p>
          <p className="mt-1 hidden max-w-lg text-xs leading-5 text-zinc-500 sm:block">
            {copy.support}
          </p>

          <span
            className={
              "mt-4 inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-[10px] font-semibold " +
              (copy.badgeTone === "gold"
                ? "border-amber-400/45 bg-amber-400/[0.08] text-amber-300"
                : "border-fuchsia-400/45 bg-fuchsia-400/[0.08] text-fuchsia-300")
            }
          >
            {copy.badge}
          </span>
        </div>

        <div className="relative flex items-end justify-end">
          <p className="pb-2 text-right text-[9px] font-medium uppercase italic leading-5 tracking-[0.18em] text-fuchsia-300/75">
            Más fuerte
            <br />
            cada versión
            <br />
            de ti
          </p>
        </div>
      </div>
    </section>
  );
}
