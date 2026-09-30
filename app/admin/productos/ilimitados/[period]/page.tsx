import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";

type PeriodKey = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const periods: Record<PeriodKey, { title: string; description: string }> = {
  monthly: { title: "Mensuales", description: "Membresías ilimitadas con vigencia de 30 días." },
  quarterly: { title: "Trimestrales", description: "Membresías ilimitadas con vigencia de 3 meses." },
  semiannual: { title: "Semestrales", description: "Membresías ilimitadas con vigencia de 6 meses." },
  annual: { title: "Anuales", description: "Membresías ilimitadas con vigencia de 1 año." },
  custom: { title: "Otra vigencia", description: "Membresías ilimitadas con duración personalizada." },
};

function isPeriodKey(value: string): value is PeriodKey {
  return value in periods;
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

function InfinityIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.2 8.5c-2.5 0-4.2 1.6-4.2 3.5s1.7 3.5 4.2 3.5c3.3 0 5-7 9.6-7 2.5 0 4.2 1.6 4.2 3.5s-1.7 3.5-4.2 3.5c-3.3 0-5-7-9.6-7Z" />
    </svg>
  );
}

export default async function UnlimitedPeriodPage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period: rawPeriod } = await params;
  if (!isPeriodKey(rawPeriod)) notFound();

  const period = periods[rawPeriod];
  const ctx = await getAdminContext("products.read");

  const { data: rows } = await ctx.supabase
    .from("product_templates")
    .select("id,name,price_minor,currency,validity_days,package_term,product_type,active")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .eq("unlimited", true)
    .in("product_type", ["package", "membership"])
    .order("name");

  const products = (rows ?? []).filter(
    (product) => resolvePeriod(product.package_term, product.validity_days) === rawPeriod,
  );

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos/ilimitados" className="packages-v2-back">
          <span aria-hidden="true">←</span> Ilimitados
        </Link>
        <h1>{period.title}</h1>
        <p>{period.description}</p>
      </header>

      <section className="packages-v2-info is-green" aria-label="Membresías activas">
        <span className="packages-v2-info-icon" aria-hidden="true">
          ∞
        </span>
        <p>Aquí ves únicamente las membresías ilimitadas activas de esta vigencia.</p>
      </section>

      {products.length ? (
        <section className="package-list" aria-label={period.title}>
          {products.map((product) => {
            const money = new Intl.NumberFormat(ctx.studio.locale, {
              style: "currency",
              currency: product.currency,
              maximumFractionDigits: 0,
            });

            return (
              <Link
                key={product.id}
                href={`/admin/productos/${product.id}`}
                className="package-list-card"
              >
                <span className="package-list-icon">
                  <InfinityIcon />
                </span>

                <span className="package-list-main">
                  <span className="package-list-title-row">
                    <strong>{product.name}</strong>
                    <span className="package-list-price">
                      {money.format(product.price_minor / 100)}
                    </span>
                  </span>
                  <span className="package-list-chip">Acceso ilimitado</span>
                  <span className="package-list-meta">
                    <span>Sin límite de créditos</span>
                    <span>
                      {product.validity_days == null
                        ? "Sin vencimiento"
                        : `${product.validity_days} días`}
                    </span>
                  </span>
                </span>

                <span className="package-list-status">Activo</span>
              </Link>
            );
          })}
        </section>
      ) : (
        <section className="packages-v2-empty">
          Aún no hay membresías ilimitadas activas en esta vigencia.
        </section>
      )}

      {ctx.can("products.write") ? (
        <Link
          href={`/admin/productos/ilimitados/nuevo?period=${rawPeriod}`}
          className="packages-v2-primary"
        >
          <span aria-hidden="true">＋</span> Crear ilimitado
        </Link>
      ) : null}
    </main>
  );
}
