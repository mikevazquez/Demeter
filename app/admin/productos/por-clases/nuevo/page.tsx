import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CreateClassPackageForm } from "../CreateClassPackageForm";

type PeriodKey = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";

const periods: Record<
  PeriodKey,
  { label: string; days: number; fixedValidity: boolean }
> = {
  monthly: { label: "Mensual", days: 30, fixedValidity: true },
  quarterly: { label: "Trimestral", days: 90, fixedValidity: true },
  semiannual: { label: "Semestral", days: 180, fixedValidity: true },
  annual: { label: "Anual", days: 365, fixedValidity: true },
  custom: { label: "Otra vigencia", days: 30, fixedValidity: false },
};

function isPeriodKey(value: string | undefined): value is PeriodKey {
  return Boolean(value && value in periods);
}

export default async function NewClassPackagePage({
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
        <Link href={`/admin/productos/por-clases/${periodKey}`} className="packages-v2-back">
          <span aria-hidden="true">←</span> {period.label}
        </Link>
        <h1>Crear paquete</h1>
        <p>
          {period.fixedValidity
            ? `Nuevo paquete ${period.label.toLowerCase()}.`
            : "Configura un paquete con una vigencia personalizada."}
        </p>
      </header>

      {!count ? (
        <section className="packages-v2-info" role="alert">
          <span className="packages-v2-info-icon" aria-hidden="true">
            !
          </span>
          <p>
            Aún no hay disciplinas activas. Crea primero una actividad con disciplina para poder
            generar un paquete que aplique a todas.
          </p>
        </section>
      ) : (
        <CreateClassPackageForm
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
