import Link from "next/link";

type Restriction = {
  code: string;
  type?: string;
  title: string;
  detail?: string | null;
  action_kind?: string | null;
  action_href?: string | null;
  action_label?: string | null;
};

function tone(actionKind?: string | null) {
  if (actionKind === "payment") {
    return {
      border: "border-amber-400/25",
      bg: "bg-amber-400/[0.06]",
      label: "text-amber-200",
      button: "border-amber-400/25 text-amber-100",
    };
  }
  if (actionKind === "profile") {
    return {
      border: "border-cyan-400/25",
      bg: "bg-cyan-400/[0.05]",
      label: "text-cyan-200",
      button: "border-cyan-400/25 text-cyan-100",
    };
  }
  return {
    border: "border-fuchsia-400/25",
    bg: "bg-fuchsia-400/[0.05]",
    label: "text-fuchsia-200",
    button: "border-fuchsia-400/25 text-fuchsia-100",
  };
}

export function BookingRestrictionCard({
  restrictions,
  compact = false,
}: {
  restrictions: Restriction[];
  compact?: boolean;
}) {
  if (!restrictions.length) return null;

  return (
    <section className="space-y-2">
      {restrictions.map((item, index) => {
        const styles = tone(item.action_kind);
        return (
          <div
            key={item.code + ":" + index}
            className={`rounded-2xl border ${styles.border} ${styles.bg} ${compact ? "p-3" : "p-4"}`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${styles.border} ${styles.label}`}
              >
                !
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${styles.label}`}>{item.title}</p>
                {item.detail ? (
                  <p className="mt-1 text-xs leading-5 text-zinc-400">{item.detail}</p>
                ) : null}
                {item.action_href ? (
                  <Link
                    href={item.action_href}
                    className={`mt-3 inline-flex rounded-xl border px-3 py-2 text-xs font-semibold ${styles.button}`}
                  >
                    {item.action_label || "Resolver requisito"}
                  </Link>
                ) : (
                  <p className="mt-2 text-xs font-semibold text-zinc-300">
                    Contacta a tu estudio para resolverlo.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
