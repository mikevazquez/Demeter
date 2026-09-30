import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CreateUnlimitedForm } from "../CreateUnlimitedForm";

type PeriodKey = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const periods: Record<PeriodKey, { label: string; days: number; fixedValidity: boolean }> = {
  monthly: { label: "Mensual", days: 30, fixedValidity: true },
  quarterly: { label: "Trimestral", days: 90, fixedValidity: true },
  semiannual: { label: "Semestral", days: 180, fixedValidity: true },
  annual: { label: "Anual", days: 365, fixedValidity: true },
  custom: { label: "Otra vigencia", days: 30, fixedValidity: false },
};

function isPeriodKey(value: string | undefined): value is PeriodKey {
  return Boolean(value && value in periods);
}

export default async function NewUnlimitedMembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await getAdminContext("products.write");
  const { period: rawPeriod } = await searchParams;
  const periodKey: PeriodKey = isPeriodKey(rawPeriod) ? rawPeriod : "monthly";
  const period = periods[periodKey];

  const { count } = await ctx.supabase
    .from("disciplines")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", ctx.studio.id)
    .eq("active", true);

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href={`/admin/productos/ilimitados/${periodKey}`} className="packages-v2-back">
          <span aria-hidden="true">←</span> {period.label}
        </Link>
        <h1>Crear ilimitado</h1>
        <p>
          {period.fixedValidity
            ? `Nueva membresía ilimitada ${period.label.toLowerCase()}.`
            : "Configura una membresía ilimitada con vigencia personalizada."}
        </p>
      </header>

      {!count ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>
            Aún no hay disciplinas activas. Necesitas al menos una para crear una membresía
            ilimitada.
          </p>
        </section>
      ) : (
        <CreateUnlimitedForm
          currency={ctx.studio.currency}
          locale={ctx.studio.locale}
          packageTerm={periodKey}
          periodLabel={period.label}
          initialDays={period.days}
          fixedValidity={period.fixedValidity}
        />
      )}
    </main>
  );
}
