import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

function TicketIcon() {
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
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19v4a3 3 0 0 0 0 6v4H6.5A2.5 2.5 0 0 1 4 16.5V7.5Z" />
      <path d="M9 8v8" strokeDasharray="2 2" />
    </svg>
  );
}

export default async function ClassPackagesPage() {
  const ctx = await getAdminContext("products.read");

  const [{ data: disciplines }, { data: rows }] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true),
    ctx.supabase
      .from("product_templates")
      .select("id,name,price_minor,currency,credit_limit,validity_days,active")
      .eq("studio_id", ctx.studio.id)
      .eq("product_type", "package")
      .eq("unlimited", false)
      .eq("active", true)
      .order("credit_limit")
      .order("name"),
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
          .select("product_template_id,recurring_schedule_id")
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

  const products = (rows ?? []).filter((product) => {
    const productDisciplineIds = disciplinesByProduct.get(product.id) ?? new Set<string>();
    const appliesToEveryActiveDiscipline =
      activeDisciplineIds.size > 0 &&
      [...activeDisciplineIds].every((disciplineId) => productDisciplineIds.has(disciplineId));

    return appliesToEveryActiveDiscipline && !scheduleRestrictedProductIds.has(product.id);
  });

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos" className="packages-v2-back">
          <span aria-hidden="true">←</span> Paquetes
        </Link>
        <h1>Por clases</h1>
        <p>Paquetes por cantidad de clases y vigencia.</p>
      </header>

      <section className="packages-v2-info is-green" aria-label="Paquetes activos">
        <span className="packages-v2-info-icon" aria-hidden="true">
          i
        </span>
        <p>Aquí ves los paquetes activos de esta categoría.</p>
      </section>

      {products.length ? (
        <section className="package-list" aria-label="Paquetes por clases activos">
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
                  <TicketIcon />
                </span>

                <span className="package-list-main">
                  <span className="package-list-title-row">
                    <strong>{product.name}</strong>
                    <span className="package-list-price">
                      {money.format(product.price_minor / 100)}
                    </span>
                  </span>
                  <span className="package-list-chip">Todas las disciplinas</span>
                  <span className="package-list-meta">
                    <span>
                      Vigencia:{" "}
                      {product.validity_days == null
                        ? "sin vencimiento"
                        : `${product.validity_days} días`}
                    </span>
                    <span>
                      {product.credit_limit == null
                        ? "Sin límite definido"
                        : `${product.credit_limit} clases`}
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
          Aún no hay paquetes activos que apliquen a todas las disciplinas.
        </section>
      )}

      {ctx.can("products.write") ? (
        <Link href="/admin/productos/por-clases/nuevo" className="packages-v2-primary">
          <span aria-hidden="true">＋</span> Crear paquete
        </Link>
      ) : null}
    </main>
  );
}
