import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { updateProduct } from "../../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const ctx = await getAdminContext("products.write");
  const [{ data: product }, { data: disciplines }] = await Promise.all([
    ctx.supabase
      .from("product_templates")
      .select(
        "id,name,description,product_type,price_minor,credit_limit,validity_days,unlimited,active,product_template_disciplines(discipline_id)",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("id", productId)
      .maybeSingle(),
    ctx.supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
  ]);
  if (!product) notFound();

  const selected = new Set(
    (product.product_template_disciplines ?? []).map((item) => item.discipline_id),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm text-zinc-400">Productos · Editor</p>
        <h1 className="text-3xl font-semibold text-white">Editar {product.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ajusta la información y reglas del producto. Las adquisiciones existentes conservan su
          propia vigencia y créditos.
        </p>
      </header>
      <form
        action={updateProduct}
        className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-7"
      >
        <input type="hidden" name="product_id" value={product.id} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2 text-sm text-zinc-300">
            Nombre
            <input
              name="name"
              required
              defaultValue={product.name}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Tipo
            <select
              name="product_type"
              required
              defaultValue={product.product_type}
              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-white"
            >
              <option value="package">Paquete</option>
              <option value="membership">Membresía</option>
              <option value="single_class">Clase suelta</option>
              <option value="other">Otro</option>
            </select>
          </label>
          <label className="text-sm text-zinc-300">
            Precio MXN
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={product.price_minor / 100}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Créditos
            <input
              name="credit_limit"
              type="number"
              min="1"
              defaultValue={product.credit_limit ?? 1}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Vigencia (días)
            <input
              name="validity_days"
              type="number"
              min="1"
              required
              defaultValue={product.validity_days}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
          <input
            name="unlimited"
            type="checkbox"
            defaultChecked={product.unlimited}
            className="h-4 w-4"
          />
          Membresía ilimitada
        </label>
        <label className="block text-sm text-zinc-300">
          Descripción
          <textarea
            name="description"
            rows={3}
            defaultValue={product.description ?? ""}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-white">Disciplinas incluidas</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {disciplines?.map((discipline) => (
              <label
                key={discipline.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-zinc-300"
              >
                <input
                  type="checkbox"
                  name="discipline_ids"
                  value={discipline.id}
                  defaultChecked={selected.has(discipline.id)}
                />
                {discipline.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end">
          <button className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
            Guardar cambios
          </button>
        </div>
      </form>
    </main>
  );
}
