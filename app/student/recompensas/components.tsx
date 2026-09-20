import Link from "next/link";

export function ProgressBar({
  percent,
  label = "Progreso",
}: {
  percent: number;
  label?: string;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));

  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safePercent}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-400"
        style={{ width: `${safePercent}%` }}
      />
    </div>
  );
}

export function SummaryTile({
  value,
  label,
  icon,
}: {
  value: number;
  label: string;
  icon: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xl font-semibold text-white">{value}</strong>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-fuchsia-500/10 text-sm text-fuchsia-300"
        >
          {icon}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{label}</p>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  count,
  href,
  action = "Ver todos →",
}: {
  eyebrow?: string;
  title: string;
  count?: number;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-0.5 text-lg font-semibold text-white">
          {title}
          {typeof count === "number" ? (
            <span className="ml-1.5 text-sm font-medium text-zinc-500">({count})</span>
          ) : null}
        </h2>
      </div>
      {href ? (
        <Link href={href} className="shrink-0 text-xs font-semibold text-fuchsia-300">
          {action}
        </Link>
      ) : null}
    </div>
  );
}

export function StateChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "magenta";
}) {
  const classes = {
    neutral: "border-white/10 bg-white/[0.05] text-zinc-300",
    success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    warning: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    magenta: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-300",
  };

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${classes[tone]}`}>
      {children}
    </span>
  );
}

export function RewardsEmpty({
  title,
  detail,
  actionHref = "/student/reservar",
  actionLabel = "Explorar clases",
}: {
  title: string;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
      <div
        aria-hidden="true"
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
      >
        ✦
      </div>
      <h2 className="mt-3 text-base font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-zinc-400">{detail}</p>
      <Link
        href={actionHref}
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
