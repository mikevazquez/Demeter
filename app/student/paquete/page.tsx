import Link from "next/link";

import { PurchasePackageButton } from "@/app/student/paquete/purchase-package-button";
import {
  formatDate,
  formatMoney,
  getStudentPortalContext,
  localDateKey,
  type StudentAcquisition,
} from "@/lib/student/portal";

const statusCopy: Record<string, string> = {
  active: "Activo",
  expired: "Vencido",
  cancelled: "Inactivo",
};

const termCopy: Record<string, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  custom: "Otra vigencia",
};

const packageGroups: Array<{ key: string; title: string; description: string }> = [
  { key: "monthly", title: "1 mes", description: "Paquetes con vigencia de 1 mes" },
  { key: "quarterly", title: "3 meses", description: "Paquetes con vigencia de 3 meses" },
  { key: "semiannual", title: "6 meses", description: "Paquetes con vigencia de 6 meses" },
  { key: "annual", title: "12 meses", description: "Paquetes con vigencia de 12 meses" },
  { key: "other", title: "Otros", description: "Otras vigencias y productos" },
];

type PurchasableProduct = {
  id: string;
  name: string;
  product_type: string;
  package_term: string | null;
  price_minor: number;
  currency: string;
  validity_days: number | null;
  credit_limit: number | null;
  unlimited: boolean;
};

type ProductDisciplineLink = {
  product_template_id: string;
  discipline_id: string;
};

type DisciplineRow = {
  id: string;
  name: string;
};

function groupKey(item: StudentAcquisition | PurchasableProduct) {
  return item.package_term && item.package_term !== "custom" ? item.package_term : "other";
}

function productBenefit(product: PurchasableProduct) {
  if (product.unlimited) return "Acceso ilimitado";
  if (product.credit_limit) return `${product.credit_limit} clases`;
  return "Paquete de clases";
}

function progressPercent(item: StudentAcquisition) {
  if (item.unlimited || !item.credit_limit || item.credit_limit <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((item.used_credits / item.credit_limit) * 100)));
}

function daysRemaining(expiresOn: string, timezone: string) {
  const today = localDateKey(new Date(), timezone);
  const oneDay = 24 * 60 * 60 * 1000;
  const end = Date.parse(`${expiresOn}T12:00:00Z`);
  const start = Date.parse(`${today}T12:00:00Z`);

  return Math.max(0, Math.round((end - start) / oneDay));
}

function remainingCopy(days: number) {
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Falta 1 día";
  return `Faltan ${days} días`;
}

function acquisitionTone(status: string) {
  if (status === "active") return "bg-emerald-500/15 text-emerald-300";
  if (status === "cancelled") return "bg-rose-500/10 text-rose-300";
  return "bg-zinc-500/15 text-zinc-400";
}

export default async function StudentPackagePage() {
  const { snapshot, studio, supabase, membership } = await getStudentPortalContext();
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const others = snapshot.acquisitions.filter((item) => item.id !== activePackage?.id);
  const activeProgress = activePackage ? progressPercent(activePackage) : null;
  const activeDaysRemaining = activePackage
    ? daysRemaining(activePackage.expires_on, studio.timezone)
    : null;

  const { data: purchasableProductRows } = await supabase
    .from("product_templates")
    .select(
      "id,name,product_type,package_term,price_minor,currency,validity_days,credit_limit,unlimited",
    )
    .eq("studio_id", membership.studio_id)
    .eq("active", true)
    .eq("online_purchasable", true)
    .in("product_type", ["package", "membership"])
    .order("price_minor", { ascending: true });

  const purchasableProducts = (purchasableProductRows ?? []) as PurchasableProduct[];
  const productDisciplineNames = new Map<string, string[]>();

  if (purchasableProducts.length) {
    const productIds = purchasableProducts.map((product) => product.id);
    const { data: productDisciplineRows } = await supabase
      .from("product_template_disciplines")
      .select("product_template_id,discipline_id")
      .eq("studio_id", membership.studio_id)
      .in("product_template_id", productIds);

    const links = (productDisciplineRows ?? []) as ProductDisciplineLink[];
    const disciplineIds = [...new Set(links.map((link) => link.discipline_id))];

    if (disciplineIds.length) {
      const { data: disciplineRows } = await supabase
        .from("disciplines")
        .select("id,name")
        .eq("studio_id", membership.studio_id)
        .eq("active", true)
        .in("id", disciplineIds);

      const disciplineNameById = new Map(
        ((disciplineRows ?? []) as DisciplineRow[]).map((discipline) => [
          discipline.id,
          discipline.name,
        ]),
      );

      for (const link of links) {
        const disciplineName = disciplineNameById.get(link.discipline_id);
        if (!disciplineName) continue;
        productDisciplineNames.set(link.product_template_id, [
          ...(productDisciplineNames.get(link.product_template_id) ?? []),
          disciplineName,
        ]);
      }

      for (const [productId, disciplineNames] of productDisciplineNames) {
        productDisciplineNames.set(
          productId,
          disciplineNames.sort((left, right) => left.localeCompare(right, "es")),
        );
      }
    }
  }

  const purchasableGroups = new Map<string, PurchasableProduct[]>();

  for (const product of purchasableProducts) {
    const key = groupKey(product);
    purchasableGroups.set(key, [...(purchasableGroups.get(key) ?? []), product]);
  }

  return (
    <main className="space-y-5 pb-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Mi paquete
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Tus clases y vigencia
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Revisa el estado de tu paquete, tus créditos y las opciones disponibles para continuar
          entrenando.
        </p>
      </header>

      {activePackage ? (
        <>
          <section
            data-package-block="active"
            className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-[radial-gradient(circle_at_14%_0%,rgba(255,10,138,0.20),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))]"
          >
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <div
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 text-2xl text-fuchsia-300 shadow-[0_0_28px_rgba(255,10,138,0.15)]"
                >
                  ◈
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      Activo
                    </span>
                    <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-medium text-zinc-300">
                      {activePackage.package_term
                        ? (termCopy[activePackage.package_term] ?? "Otra vigencia")
                        : "Otra vigencia"}
                    </span>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-white sm:text-2xl">
                    {activePackage.name}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {activePackage.unlimited
                      ? "Acceso ilimitado"
                      : activePackage.credit_limit
                        ? `${activePackage.credit_limit} clases incluidas`
                        : "Paquete de clases"}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Vigencia</p>
                  <p className="mt-1 text-sm text-white">
                    {formatDate(activePackage.starts_on, studio.timezone, studio.locale)} →{" "}
                    {formatDate(activePackage.expires_on, studio.timezone, studio.locale)}
                  </p>
                </div>
                {activeDaysRemaining !== null ? (
                  <div className="sm:text-right">
                    <p className="text-xs text-zinc-500">Vencimiento</p>
                    <strong className="mt-1 block text-sm text-white">
                      {remainingCopy(activeDaysRemaining)}
                    </strong>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                <div className="p-4 text-center">
                  <strong className="block text-2xl text-white">
                    {activePackage.unlimited ? "∞" : activePackage.available_credits}
                  </strong>
                  <span className="mt-1 block text-[11px] text-zinc-500">Disponibles</span>
                </div>
                <div className="border-x border-white/10 p-4 text-center">
                  <strong className="block text-2xl text-white">
                    {activePackage.reserved_credits}
                  </strong>
                  <span className="mt-1 block text-[11px] text-zinc-500">Reservadas</span>
                </div>
                <div className="p-4 text-center">
                  <strong className="block text-2xl text-white">
                    {activePackage.used_credits}
                  </strong>
                  <span className="mt-1 block text-[11px] text-zinc-500">Utilizadas</span>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Link
                  href="/student/reservar"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                >
                  Reservar clase
                </Link>
                <Link
                  href="/student/movimientos"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-fuchsia-500/45 bg-fuchsia-500/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500/[0.09]"
                >
                  Ver movimientos
                </Link>
              </div>
            </div>
          </section>

          <section
            data-package-block="progress"
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
          >
            {activeProgress !== null && activePackage.credit_limit ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Tu progreso</h2>
                    <p className="mt-1 text-sm text-zinc-400">
                      {activePackage.used_credits} de {activePackage.credit_limit} clases utilizadas
                    </p>
                  </div>
                  <strong className="text-lg text-white">{activeProgress}%</strong>
                </div>
                <div
                  role="progressbar"
                  aria-label="Progreso de clases utilizadas"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={activeProgress}
                  className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"
                >
                  <div
                    className="h-full rounded-full bg-fuchsia-500"
                    style={{ width: `${activeProgress}%` }}
                  />
                </div>
                <p className="mt-4 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-xs leading-5 text-zinc-500">
                  Las clases reservadas se muestran por separado. El saldo disponible proviene del
                  ledger real de tu paquete.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Acceso ilimitado</h2>
                    <p className="mt-1 text-sm text-zinc-400">
                      Este paquete no usa un límite de créditos por clase.
                    </p>
                  </div>
                  <strong className="text-3xl text-fuchsia-300">∞</strong>
                </div>
                <p className="mt-4 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-xs leading-5 text-zinc-500">
                  Tus reservas y clases utilizadas siguen registrándose en Movimientos.
                </p>
              </>
            )}
          </section>
        </>
      ) : (
        <section
          data-package-block="empty"
          className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-7 text-center sm:p-9"
        >
          <div
            aria-hidden="true"
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/10 text-2xl text-fuchsia-300"
          >
            ◈
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">No tienes un paquete activo</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
            Tus paquetes anteriores seguirán visibles como historial. Si hay opciones disponibles
            para compra online, podrás elegir una más abajo.
          </p>
          {purchasableProducts.length ? (
            <a
              href="#catalogo-paquetes"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Ver paquetes disponibles
            </a>
          ) : null}
        </section>
      )}

      {others.length ? (
        <section
          data-package-block="history"
          className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
        >
          <div>
            <h2 className="text-lg font-semibold text-white">Otros paquetes</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Consulta tus otras vigencias y paquetes anteriores.
            </p>
          </div>

          <div className="mt-4 divide-y divide-white/10">
            {others.map((item) => (
              <article
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDate(item.starts_on, studio.timezone, studio.locale)} →{" "}
                    {formatDate(item.expires_on, studio.timezone, studio.locale)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {item.unlimited
                      ? "Acceso ilimitado"
                      : `${item.available_credits ?? 0} disponibles · ${item.reserved_credits} reservadas · ${item.used_credits} utilizadas`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${acquisitionTone(
                    item.status,
                  )}`}
                >
                  {statusCopy[item.status] ?? item.status}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {purchasableProducts.length ? (
        <section
          id="catalogo-paquetes"
          data-package-block="catalog"
          className="scroll-mt-6 space-y-4"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
              Compra online
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">Adquirir o renovar paquete</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Elige entre los productos habilitados por el estudio. El pago se completa de forma
              segura en Mercado Pago.
            </p>
          </div>

          {packageGroups.map((group) => {
            const products = purchasableGroups.get(group.key) ?? [];
            if (!products.length) return null;

            return (
              <details
                key={group.key}
                name="package-term-catalog"
                className="group rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                      {group.title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{group.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-zinc-400">
                      {products.length}
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-lg text-zinc-500 transition group-open:rotate-180 group-open:text-fuchsia-300"
                    >
                      ⌄
                    </span>
                  </div>
                </summary>

                <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                  {products.map((product) => (
                    <article
                      key={product.id}
                      className="flex min-h-44 flex-col rounded-2xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] text-zinc-400">
                            {product.package_term
                              ? (termCopy[product.package_term] ?? "Otra vigencia")
                              : "Otra vigencia"}
                          </span>
                          <h3 className="mt-3 text-base font-semibold text-white">
                            {product.name}
                          </h3>
                          <p className="mt-1 text-sm text-zinc-400">{productBenefit(product)}</p>
                        </div>
                        <strong className="shrink-0 text-base text-white">
                          {formatMoney(product.price_minor, product.currency, studio.locale)}
                        </strong>
                      </div>

                      <div className="mt-3 space-y-1 text-xs leading-5 text-zinc-500">
                        {product.validity_days ? (
                          <p>Vigencia: {product.validity_days} días desde la activación</p>
                        ) : null}
                        <p>
                          Disciplinas:{" "}
                          {(productDisciplineNames.get(product.id) ?? []).length
                            ? (productDisciplineNames.get(product.id) ?? []).join(" · ")
                            : "Sin disciplinas habilitadas"}
                        </p>
                      </div>

                      <div className="mt-auto flex items-end justify-between gap-3 border-t border-white/10 pt-4">
                        <p className="max-w-[13rem] text-[11px] leading-4 text-zinc-600">
                          Serás enviado a Mercado Pago para completar el pago.
                        </p>
                        <PurchasePackageButton
                          productTemplateId={product.id}
                          productName={product.name}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            );
          })}
        </section>
      ) : null}

      {snapshot.enrollment ? (
        <section
          data-package-block="enrollment"
          className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/10 text-fuchsia-300"
              >
                ✓
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500">Estado de inscripción</p>
                <h2 className="mt-0.5 text-base font-semibold text-white">
                  {snapshot.enrollment.active_now ? "Vigente" : "Sin vigencia actual"}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {snapshot.enrollment.expires_on
                    ? `Vence ${formatDate(snapshot.enrollment.expires_on, studio.timezone, studio.locale)}`
                    : snapshot.enrollment.active_now
                      ? "Vitalicia · sin vencimiento"
                      : "Consulta el estado con el estudio"}
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                snapshot.enrollment.active_now
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-zinc-500/15 text-zinc-400"
              }`}
            >
              {snapshot.enrollment.status}
            </span>
          </div>
          <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-zinc-500">
            Aquí sólo se muestra el estado vigente. La gestión de inscripción y documentos
            corresponde a su flujo específico.
          </p>
        </section>
      ) : null}
    </main>
  );
}
