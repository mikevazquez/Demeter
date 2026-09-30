import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

type PeriodKey = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const periodCards: Array<{
  key: PeriodKey;
  title: string;
  description: string;
  tone: string;
  days: number | null;
}> = [
  {
    key: "monthly",
    title: "Mensuales",
    description: "Paquetes con vigencia de 30 días.",
    tone: "",
    days: 30,
  },
  {
    key: "quarterly",
    title: "Trimestrales",
    description: "Paquetes con vigencia de 3 meses.",
    tone: "is-blue",
    days: 90,
  },
  {
    key: "semiannual",
    title: "Semestrales",
    description: "Paquetes con vigencia de 6 meses.",
    tone: "is-amber",
    days: 180,
  },
  {
    key: "annual",
    title: "Anuales",
    description: "Paquetes con vigencia de 1 año.",
    tone: "is-purple",
    days: 365,
  },
  {
    key: "custom",
    title: "Otra vigencia",
    description: "Paquetes con una duración personalizada.",
    tone: "is-neutral",
    days: null,
  },
];

function CalendarIcon({ days }: { days: number | null }) {
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
        <path d="M9 15h6M12 12v6" />
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

export default async function ClassPackagesPage() {
  const ctx = await getAdminContext("products.read");

  const [{ data: disciplines }, { data: rows }] = await Promise.all([
    ctx.supabase.from("disciplines").select("id").eq("studio_id", ctx.studio.id).eq("active", true),
    ctx.supabase
      .from("product_templates")
      .select("id,package_term,validity_days")
      .eq("studio_id", ctx.studio.id)
      .eq("product_type", "package")
      .eq("unlimited", false)
      .eq("active", true),
  ]);

  const productIds = (rows ?? []).map((product) => product.id);
  const [{ data: disciplineLinks }, { data: scheduleLinks }] = productIds.length
    ? await Promise.all([
        ctx.supabase
          .from("product_template_disciplines")
          .select("product_template_id,discipline_id")
          .eq("studio_id", ctx.studio.id)
          .in("product_template_id", productIds),
        ctx.supabase
          .from("product_template_schedules")
          .select("product_template_id")
          .eq("studio_id", ctx.studio.id)
          .in("product_template_id", productIds),
      ])
    : [{ data: [] }, { data: [] }];

  const activeDisciplineIds = new Set((disciplines ?? []).map((item) => item.id));
  const disciplinesByProduct = new Map<string, Set<string>>();
  for (const link of disciplineLinks ?? []) {
    const current = disciplinesByProduct.get(link.product_template_id) ?? new Set<string>();
    current.add(link.discipline_id);
    disciplinesByProduct.set(link.product_template_id, current);
  }

  const scheduleRestrictedProductIds = new Set(
    (scheduleLinks ?? []).map((link) => link.product_template_id),
  );

  const counts: Record<PeriodKey, number> = {
    monthly: 0,
    quarterly: 0,
    semiannual: 0,
    annual: 0,
    custom: 0,
  };

  for (const product of rows ?? []) {
    const productDisciplineIds = disciplinesByProduct.get(product.id) ?? new Set<string>();
    const appliesToEveryActiveDiscipline =
      activeDisciplineIds.size > 0 &&
      [...activeDisciplineIds].every((disciplineId) => productDisciplineIds.has(disciplineId));

    if (!appliesToEveryActiveDiscipline || scheduleRestrictedProductIds.has(product.id)) continue;
    counts[resolvePeriod(product.package_term, product.validity_days)] += 1;
  }

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos" className="packages-v2-back">
          <span aria-hidden="true">←</span> Paquetes
        </Link>
        <h1>Por clases</h1>
        <p>Elige la vigencia del paquete que quieres administrar.</p>
      </header>

      <section className="packages-v2-info is-green" aria-label="Organización por vigencia">
        <span className="packages-v2-info-icon" aria-hidden="true">
          i
        </span>
        <p>Dentro de cada vigencia verás únicamente los paquetes activos de ese periodo.</p>
      </section>

      <section className="package-category-grid" aria-label="Vigencias de paquetes">
        {periodCards.map((period) => (
          <Link
            key={period.key}
            href={`/admin/productos/por-clases/${period.key}`}
            className={`package-category-card ${period.tone}`}
          >
            <span className="package-category-icon">
              <CalendarIcon days={period.days} />
            </span>
            <span className="package-category-copy">
              <strong>{period.title}</strong>
              <span>{period.description}</span>
              <small className="package-period-count">
                {counts[period.key]}{" "}
                {counts[period.key] === 1 ? "paquete activo" : "paquetes activos"}
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
