import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

type PeriodKey = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const periods: Array<{
  key: PeriodKey;
  title: string;
  description: string;
  days: number | null;
  tone: string;
}> = [
  { key: "monthly", title: "Mensuales", description: "Acceso ilimitado por 30 días.", days: 30, tone: "" },
  { key: "quarterly", title: "Trimestrales", description: "Acceso ilimitado por 3 meses.", days: 90, tone: "is-blue" },
  { key: "semiannual", title: "Semestrales", description: "Acceso ilimitado por 6 meses.", days: 180, tone: "is-amber" },
  { key: "annual", title: "Anuales", description: "Acceso ilimitado por 1 año.", days: 365, tone: "is-purple" },
  { key: "custom", title: "Otra vigencia", description: "Acceso ilimitado con duración personalizada.", days: null, tone: "is-neutral" },
];

function CalendarInfinityIcon({ days }: { days: number | null }) {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4M17 3v4M3 10h18" />
      {days ? (
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          fontSize="6.5"
          fontWeight="800"
        >
          {days}
        </text>
      ) : (
        <path d="M8.3 15c1.2-2 2.4-2 3.7 0 1.3 2 2.5 2 3.7 0" />
      )}
    </svg>
  );
}

function resolvePeriod(packageTerm: string | null, validityDays: number | null): PeriodKey {
  if (
    packageTerm === "monthly" ||
    packageTerm === "quarterly" ||
    packageTerm === "semiannual" ||
    packageTerm === "annual"
  ) {
    return packageTerm;
  }
  if (validityDays === 30) return "monthly";
  if (validityDays === 90) return "quarterly";
  if (validityDays === 180) return "semiannual";
  if (validityDays === 365) return "annual";
  return "custom";
}

export default async function UnlimitedPackagesPage() {
  const ctx = await getAdminContext("products.read");

  const { data: rows } = await ctx.supabase
    .from("product_templates")
    .select("id,package_term,validity_days")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .eq("unlimited", true)
    .in("product_type", ["package", "membership"]);

  const counts: Record<PeriodKey, number> = {
    monthly: 0,
    quarterly: 0,
    semiannual: 0,
    annual: 0,
    custom: 0,
  };

  for (const product of rows ?? []) {
    counts[resolvePeriod(product.package_term, product.validity_days)] += 1;
  }

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos" className="packages-v2-back">
          <span aria-hidden="true">←</span> Paquetes
        </Link>
        <h1>Ilimitados</h1>
        <p>Elige la vigencia de la membresía ilimitada que quieres administrar.</p>
      </header>

      <section className="packages-v2-info is-green" aria-label="Membresías ilimitadas">
        <span className="packages-v2-info-icon" aria-hidden="true">
          ∞
        </span>
        <p>Estas membresías permiten reservar sin descontar créditos mientras estén vigentes.</p>
      </section>

      <section className="package-category-grid" aria-label="Vigencias ilimitadas">
        {periods.map((period) => (
          <Link
            key={period.key}
            href={`/admin/productos/ilimitados/${period.key}`}
            className={`package-category-card ${period.tone}`}
          >
            <span className="package-category-icon">
              <CalendarInfinityIcon days={period.days} />
            </span>
            <span className="package-category-copy">
              <strong>{period.title}</strong>
              <span>{period.description}</span>
              <small className="package-period-count">
                {counts[period.key]} {counts[period.key] === 1 ? "membresía activa" : "membresías activas"}
              </small>
            </span>
            <span className="package-category-action">
              Ver <span aria-hidden="true">›</span>
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
