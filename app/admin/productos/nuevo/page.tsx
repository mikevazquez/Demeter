import { getAdminContext } from "@/lib/auth/admin-context";
import { createProduct } from "../actions";
import { ProductFormFields } from "../product-form-fields";

export default async function NewProductPage() {
  const ctx = await getAdminContext("products.write");
  const { data: disciplines } = await ctx.supabase
    .from("disciplines")
    .select("id,name")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("name");

  return (
    <main className="dashboard-shell admin-ux04-secondary-detail product-editor-page">
      <header>
        <p className="text-sm text-zinc-400">Productos</p>
        <h1 className="text-3xl font-semibold text-white">Nuevo producto</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Configura el producto según su tipo. La inscripción se gestiona como un derecho
          administrativo y no como un paquete de clases.
        </p>
      </header>
      <form
        action={createProduct}
        className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-7"
      >
        <label className="block text-sm text-zinc-300">
          Nombre
          <input
            name="name"
            required
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
            placeholder="Ej. Paquete 12 clases"
          />
        </label>

        <ProductFormFields disciplines={disciplines ?? []} />

        <label className="block text-sm text-zinc-300">
          Descripción
          <textarea
            name="description"
            rows={3}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

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
