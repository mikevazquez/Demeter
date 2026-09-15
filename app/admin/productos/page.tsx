import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";

const labels: Record<string, string> = {
  package: "Paquete",
  membership: "Membresía",
  single_class: "Clase suelta",
  enrollment: "Inscripción",
  other: "Otro",
};

export default async function ProductsPage() {
  const ctx = await getAdminContext("products.read");
  const { data: products } = await ctx.supabase
    .from("product_templates")
    .select("id,name,product_type,price_minor,currency,credit_limit,validity_days,unlimited,active")
    .eq("studio_id", ctx.studio.id)
    .order("active", { ascending: false })
    .order("name");

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400">Catálogo comercial</p>
          <h1 className="text-3xl font-semibold text-white">Productos</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Paquetes, membresías, clases e inscripciones disponibles para tu estudio.
          </p>
        </div>
        {ctx.can("products.write") ? (
          <Link
            href="/admin/productos/nuevo"
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Nuevo producto
          </Link>
        ) : null}
      </header>

      {!products?.length ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <h2 className="font-semibold text-white">Aún no hay productos</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Crea el primer producto para comenzar el catálogo.
          </p>
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/admin/productos/${product.id}`}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/40 hover:bg-white/[0.05]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-fuchsia-300">
                    {labels[product.product_type] ?? product.product_type}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{product.name}</h2>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${product.active ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"}`}
                >
                  {product.active ? "Activo" : "Inactivo"}
                </span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {new Intl.NumberFormat("es-MX", {
                      style: "currency",
                      currency: product.currency,
                    }).format(product.price_minor / 100)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Vigencia{" "}
                    {product.validity_days == null ? "Vitalicia" : `${product.validity_days} días`}
                  </p>
                </div>
                <p className="text-sm text-zinc-300">
                  {product.product_type === "enrollment"
                    ? "Derecho administrativo"
                    : product.unlimited
                      ? "Ilimitado"
                      : `${product.credit_limit} créditos`}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
