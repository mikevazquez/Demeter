import Link from "next/link";

import { PurchasePackageButton } from "@/app/student/paquete/purchase-package-button";
import {
  formatDate,
  formatMoney,
  getStudentPortalContext,
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

const packageGroups: Array<{ key: string; title: string }> = [
  { key: "monthly", title: "1 mes" },
  { key: "quarterly", title: "3 meses" },
  { key: "semiannual", title: "6 meses" },
  { key: "annual", title: "12 meses" },
  { key: "other", title: "Otros" },
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
  if (product.unlimited) return "Clases ilimitadas";
  if (product.credit_limit) {
    return `${product.credit_limit} ${product.credit_limit === 1 ? "clase" : "clases"}`;
  }
  return "Paquete de clases";
}

function acquisitionTone(status: string) {
  if (status === "active") return "bg-emerald-500/15 text-emerald-300";
  if (status === "cancelled") return "bg-rose-500/10 text-rose-300";
  return "bg-zinc-500/15 text-zinc-400";
}

export default async function StudentPackagePage() {
  const { snapshot, studio, supabase, membership } = await getStudentPortalContext();

  const packageAcquisitions = snapshot.acquisitions.filter((item) => !item.reward_credit_wallet);
  const extraClassWallets = snapshot.acquisitions.filter(
    (item) => item.reward_credit_wallet && item.active_now && item.status === "active",
  );
  const activePackage = packageAcquisitions.find((item) => item.active_now) ?? null;
  const others = packageAcquisitions
    .filter((item) => item.id !== activePackage?.id)
    .sort((left, right) => right.expires_on.localeCompare(left.expires_on));

  const extraClassesAvailable = extraClassWallets.reduce(
    (total, item) => total + (item.available_credits ?? 0),
    0,
  );
  const extraClassesExpiry =
    extraClassWallets
      .map((item) => item.expires_on)
      .filter(Boolean)
      .sort()[0] ?? null;

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
        <p className="student-eyebrow">Mi membresía</p>
        <h1 className="student-page-title mt-1">Mi paquete</h1>
        <p className="student-body mt-2">
          Consulta cuántas clases tienes disponibles y hasta cuándo puedes usarlas.
        </p>
      </header>

      {activePackage ? (
        <section data-package-block="active" className="student-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                Activo
              </span>
              <h2 className="mt-3 text-xl font-semibold text-white">{activePackage.name}</h2>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {activePackage.unlimited
                  ? "Clases ilimitadas"
                  : `${activePackage.available_credits ?? 0} clases disponibles`}
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                Vence el {formatDate(activePackage.expires_on, studio.timezone)}
              </p>
              {activePackage.reserved_credits > 0 ? (
                <p className="mt-1 text-sm text-zinc-500">
                  {activePackage.reserved_credits}{" "}
                  {activePackage.reserved_credits === 1
                    ? "próxima clase reservada"
                    : "próximas clases reservadas"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 border-t border-white/10 pt-5 sm:flex-row">
            <Link href="/student/reservar" className="student-action-primary w-full sm:w-auto">
              Reservar clase
            </Link>
            <Link href="/student/movimientos" className="student-action-secondary w-full sm:w-auto">
              Ver uso de mis clases
            </Link>
          </div>
        </section>
      ) : (
        <section data-package-block="empty" className="student-card p-6 text-center sm:p-8">
          <h2 className="text-lg font-semibold text-white">No tienes un paquete activo</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
            Elige un paquete para seguir reservando tus clases en Demeter.
          </p>
          {purchasableProducts.length ? (
            <a href="#catalogo-paquetes" className="student-action-primary mt-5 w-full sm:w-auto">
              Ver paquetes
            </a>
          ) : null}
        </section>
      )}

      {extraClassesAvailable > 0 ? (
        <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.045] p-4">
          <p className="text-xs font-semibold text-emerald-300">Clases extra</p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {extraClassesAvailable} {extraClassesAvailable === 1 ? "clase extra disponible" : "clases extra disponibles"}
          </h2>
          {extraClassesExpiry ? (
            <p className="mt-1 text-sm text-zinc-400">
              Disponibles hasta {formatDate(extraClassesExpiry, studio.timezone)}
            </p>
          ) : null}
        </section>
      ) : null}

      {purchasableProducts.length ? (
        <section id="catalogo-paquetes" data-package-block="catalog" className="scroll-mt-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {activePackage ? "Renovar o cambiar paquete" : "Elige tu paquete"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Revisa las clases, vigencia y precio antes de pagar.
            </p>
          </div>

          {packageGroups.map((group) => {
            const products = purchasableGroups.get(group.key) ?? [];
            if (!products.length) return null;

            return (
              <details
                key={group.key}
                name="package-term-catalog"
                className="group rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{group.title}</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {products.length} {products.length === 1 ? "opción" : "opciones"}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-xl text-zinc-500 transition group-open:rotate-180"
                  >
                    ⌄
                  </span>
                </summary>

                <div className="mt-3 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                  {products.map((product) => {
                    const disciplines = productDisciplineNames.get(product.id) ?? [];

                    return (
                      <article
                        key={product.id}
                        className="flex flex-col rounded-2xl border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h4 className="text-base font-semibold text-white">{product.name}</h4>
                            <p className="mt-1 text-sm text-zinc-400">{productBenefit(product)}</p>
                          </div>
                          <strong className="shrink-0 text-base text-white">
                            {formatMoney(product.price_minor, product.currency)}
                          </strong>
                        </div>

                        <div className="mt-3 space-y-1 text-sm leading-5 text-zinc-500">
                          {product.validity_days ? (
                            <p>Vigencia: {product.validity_days} días</p>
                          ) : null}
                          {disciplines.length ? <p>{disciplines.join(" · ")}</p> : null}
                        </div>

                        <div className="mt-4 border-t border-white/10 pt-4">
                          <PurchasePackageButton
                            productTemplateId={product.id}
                            productName={product.name}
                            buttonLabel={activePackage ? "Comprar" : "Elegir"}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </section>
      ) : null}

      {snapshot.enrollment ? (
        <section data-package-block="enrollment" className="student-card p-5">
          <p className="student-eyebrow">Inscripción</p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">
                {snapshot.enrollment.active_now ? "Inscripción vigente" : "Sin inscripción vigente"}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {snapshot.enrollment.expires_on
                  ? `Vence ${formatDate(snapshot.enrollment.expires_on, studio.timezone)}`
                  : snapshot.enrollment.active_now
                    ? "Sin fecha de vencimiento"
                    : "Consulta con Demeter para regularizarla"}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                snapshot.enrollment.active_now
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {snapshot.enrollment.active_now ? "Vigente" : "Pendiente"}
            </span>
          </div>
        </section>
      ) : null}

      {others.length ? (
        <details
          data-package-block="history"
          className="group rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">Historial de paquetes</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {others.length} {others.length === 1 ? "paquete anterior" : "paquetes anteriores"}
              </p>
            </div>
            <span aria-hidden="true" className="text-xl text-zinc-500 transition group-open:rotate-180">
              ⌄
            </span>
          </summary>

          <div className="mt-3 divide-y divide-white/10 border-t border-white/10">
            {others.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{item.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDate(item.starts_on, studio.timezone)} →{" "}
                    {formatDate(item.expires_on, studio.timezone)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${acquisitionTone(
                    item.status,
                  )}`}
                >
                  {statusCopy[item.status] ?? item.status}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </main>
  );
}
