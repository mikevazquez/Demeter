import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

const labels: Record<string, string> = {
  package: "Paquete",
  membership: "Membresía",
  single_class: "Clase suelta",
  enrollment: "Inscripción",
  other: "Otro",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext("products.read");
  const status = params.status === "inactive" ? "inactive" : "active";

  const { data: products } = await ctx.supabase
    .from("product_templates")
    .select("id,name,product_type,price_minor,currency,credit_limit,validity_days,unlimited,active")
    .eq("studio_id", ctx.studio.id)
    .eq("active", status === "active")
    .order("name");

  return (
    <main className="dashboard-shell admin-module-page admin-ux04-secondary">
      <header className="module-header">
        <div>
          <h1>Productos</h1>
          <p>Catálogo de productos y servicios.</p>
        </div>
        {ctx.can("products.write") ? (
          <Link href="/admin/productos/nuevo" className="module-primary-action">
            ＋ Nuevo
          </Link>
        ) : null}
      </header>

      <nav className="module-tabs" aria-label="Estado de productos">
        <Link className={status === "active" ? "is-active" : ""} href="/admin/productos">
          Activos
        </Link>
        <Link
          className={status === "inactive" ? "is-active" : ""}
          href="/admin/productos?status=inactive"
        >
          Inactivos
        </Link>
      </nav>

      {!products?.length ? (
        <section className="module-empty">
          {status === "active" ? "Aún no hay productos activos." : "No hay productos inactivos."}
        </section>
      ) : (
        <section className="module-list">
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/admin/productos/${product.id}`}
              className="module-list-row product-list-row"
            >
              <span className="module-row-icon" aria-hidden="true">
                ▣
              </span>
              <span className="module-row-copy">
                <strong>{product.name}</strong>
                <small>
                  {labels[product.product_type] ?? product.product_type} ·{" "}
                  {product.validity_days == null
                    ? "Vitalicia"
                    : `Vigencia ${product.validity_days} días`}
                </small>
              </span>
              <span className="module-row-meta">
                <strong>
                  {new Intl.NumberFormat(ctx.studio.locale, {
                    style: "currency",
                    currency: product.currency,
                  }).format(product.price_minor / 100)}
                </strong>
                <small>
                  {product.product_type === "enrollment"
                    ? "Derecho administrativo"
                    : product.unlimited
                      ? "Ilimitado"
                      : `${product.credit_limit} créditos`}
                </small>
              </span>
              <span className="module-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
