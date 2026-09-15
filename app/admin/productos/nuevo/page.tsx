import { getAdminContext } from "@/lib/auth/admin-context";
import { createProduct } from "../actions";

export default async function NewProductPage() {
  const ctx = await getAdminContext("products.write");
  const { data: disciplines } = await ctx.supabase
    .from("disciplines")
    .select("id,name")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("name");

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm text-zinc-400">Productos</p>
        <h1 className="text-3xl font-semibold text-white">Nuevo producto</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Define precio, créditos, vigencia y las disciplinas incluidas.
        </p>
      </header>
      <form
        action={createProduct}
        className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-7"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2 text-sm text-zinc-300">
            Nombre
            <input
              name="name"
              required
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              placeholder="Ej. Paquete 12 clases"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Tipo
            <select
              name="product_type"
              required
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
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Créditos
            <input
              name="credit_limit"
              type="number"
              min="1"
              defaultValue="8"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Vigencia (días)
            <input
              name="validity_days"
              type="number"
              min="1"
              defaultValue="30"
              required
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            />
          </label>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
          <input name="unlimited" type="checkbox" className="h-4 w-4" /> Membresía ilimitada (ignora
          el número de créditos)
        </label>
        <label className="block text-sm text-zinc-300">
          Descripción
          <textarea
            name="description"
            rows={3}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-white">Disciplinas incluidas</legend>
          <p className="mt-1 text-xs text-zinc-500">
            Selecciona las disciplinas a las que da acceso este producto.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {disciplines?.map((discipline) => (
              <label
                key={discipline.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-zinc-300"
              >
                <input type="checkbox" name="discipline_ids" value={discipline.id} />
                {discipline.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Crear producto
          </button>
        </div>
      </form>
    </main>
  );
}
