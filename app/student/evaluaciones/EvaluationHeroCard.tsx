type EvaluationHeroVariant =
  | "diagnostic_completed"
  | "level_up"
  | "level_maintained"
  | "scheduled";

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
      ? scheduledLabel ?? "Evaluación programada"
      : variant === "level_up"
        ? `Nuevo nivel: ${levelName ?? "Nivel técnico"}`
        : levelName ?? "Nivel técnico";

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-fuchsia-500/35 bg-[linear-gradient(135deg,#250919_0%,#140813_42%,#090d13_100%)] shadow-[0_0_34px_rgba(236,72,153,0.10)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_28%,rgba(236,72,153,0.34),transparent_27%),radial-gradient(circle_at_94%_5%,rgba(168,85,247,0.16),transparent_28%)]" />
      <div className="absolute inset-y-0 right-[27%] w-px bg-gradient-to-b from-transparent via-fuchsia-400/75 to-transparent shadow-[0_0_16px_rgba(236,72,153,0.65)]" />

      <div className="pointer-events-none absolute right-5 top-5 hidden h-40 w-28 sm:block" aria-hidden="true">
        <span className="absolute right-8 top-2 h-10 w-10 rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 shadow-[0_0_24px_rgba(236,72,153,0.3)]" />
        <span className="absolute right-6 top-11 h-24 w-12 -rotate-12 rounded-[55%_45%_52%_48%] bg-gradient-to-b from-fuchsia-300/18 via-fuchsia-500/13 to-transparent" />
        <span className="absolute right-1 top-6 h-28 w-2 rotate-[18deg] rounded-full bg-fuchsia-300/16" />
        <span className="absolute right-12 top-[74px] h-2 w-16 -rotate-[28deg] rounded-full bg-fuchsia-300/13" />
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
