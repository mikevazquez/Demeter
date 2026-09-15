import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { setProductActive } from "../actions";

const labels: Record<string, string> = {
  package: "Paquete",
  membership: "Membresía",
  single_class: "Clase suelta",
  other: "Otro",
};

type ProductDiscipline = {
  disciplines: { name: string }[];
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const ctx = await getAdminContext("products.read");
  const { data: product } = await ctx.supabase
    .from("product_templates")
    .select(
      "id,name,description,product_type,price_minor,currency,credit_limit,validity_days,unlimited,active,product_template_disciplines(disciplines(name))",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("id", productId)
    .maybeSingle();
  if (!product) notFound();

  const productDisciplines: ProductDiscipline[] = product.product_template_disciplines ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-fuchsia-300">
            {labels[product.product_type] ?? product.product_type}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-white">{product.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            {product.description || "Sin descripción."}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm ${product.active ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"}`}
        >
          {product.active ? "Activo" : "Inactivo"}
        </span>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs text-zinc-500">Precio</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {new Intl.NumberFormat("es-MX", {
              style: "currency",
              currency: product.currency,
            }).format(product.price_minor / 100)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs text-zinc-500">Créditos</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {product.unlimited ? "Ilimitados" : product.credit_limit}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs text-zinc-500">Vigencia</p>
          <p className="mt-2 text-xl font-semibold text-white">{product.validity_days} días</p>
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-semibold text-white">Disciplinas incluidas</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {productDisciplines.length ? (
            productDisciplines.map((item, index) => (
              <span
                key={index}
                className="rounded-full bg-white/[0.06] px-3 py-1 text-sm text-zinc-300"
              >
                {item.disciplines[0]?.name}
              </span>
            ))
          ) : (
            <p className="text-sm text-zinc-500">Sin disciplinas asignadas.</p>
          )}
        </div>
      </section>
      {ctx.can("products.write") ? (
        <form action={setProductActive}>
          <input type="hidden" name="product_id" value={product.id} />
          <input type="hidden" name="active" value={product.active ? "false" : "true"} />
          <button className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/[0.05]">
            {product.active ? "Desactivar producto" : "Reactivar producto"}
          </button>
        </form>
      ) : null}
    </main>
  );
}
