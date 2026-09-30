import Link from "next/link";
import { notFound } from "next/navigation";

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

export default async function ActivityPackagesPage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const { activityId } = await params;
  const ctx = await getAdminContext("products.read");

  const { data: activity } = await ctx.supabase
    .from("class_templates")
    .select("id,name,description,active")
    .eq("studio_id", ctx.studio.id)
    .eq("id", activityId)
    .maybeSingle();

  if (!activity) notFound();

  const { data: links } = await ctx.supabase
    .from("product_template_activities")
    .select("product_template_id")
    .eq("studio_id", ctx.studio.id)
    .eq("class_template_id", activity.id);

  const productIds = (links ?? []).map((link) => link.product_template_id);
  const { data: products } = productIds.length
    ? await ctx.supabase
        .from("product_templates")
        .select(
          "id,name,price_minor,currency,credit_limit,validity_days,package_term,active",
        )
        .eq("studio_id", ctx.studio.id)
        .eq("active", true)
        .in("id", productIds)
        .order("name")
    : { data: [] as {
        id: string;
        name: string;
        price_minor: number;
        currency: string;
        credit_limit: number | null;
        validity_days: number | null;
        package_term: string | null;
        active: boolean;
      }[] };

  return (
    <main className="packages-v2">
      <header className="packages-v2-header">
        <Link href="/admin/productos/cursos-talleres" className="packages-v2-back">
          <span aria-hidden="true">←</span> Cursos y talleres
        </Link>
        <h1>{activity.name}</h1>
        <p>Paquetes vinculados únicamente a esta actividad.</p>
      </header>

      <section className="packages-v2-info is-green" aria-label="Actividad vinculada">
        <span className="packages-v2-info-icon" aria-hidden="true">
          ✓
        </span>
        <p>
          Quien tenga uno de estos paquetes podrá usar sus créditos solo en {activity.name}.
        </p>
      </section>

      {products?.length ? (
        <section className="package-list" aria-label={`Paquetes de ${activity.name}`}>
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
                  <span className="package-list-chip">Solo {activity.name}</span>
                  <span className="package-list-meta">
                    <span>
                      {product.credit_limit == null
                        ? "Sin límite definido"
                        : `${product.credit_limit} clases`}
                    </span>
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
          Aún no hay paquetes activos vinculados a esta actividad.
        </section>
      )}

      {ctx.can("products.write") && activity.active ? (
        <Link
          href={`/admin/productos/cursos-talleres/nuevo?activity=${activity.id}`}
          className="packages-v2-primary"
        >
          <span aria-hidden="true">＋</span> Crear paquete
        </Link>
      ) : null}
    </main>
  );
}
