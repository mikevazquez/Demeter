import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { updateProduct } from "../../actions";
import { ProductFormFields } from "../../product-form-fields";

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

  const selectedDisciplineIds = (product.product_template_disciplines ?? []).map(
    (item) => item.discipline_id,
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm text-zinc-400">Productos · Editor</p>
        <h1 className="text-3xl font-semibold text-white">Editar {product.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ajusta la información y reglas del producto. Las adquisiciones e inscripciones existentes
          conservan su propia historia.
        </p>
      </header>
      <form
        action={updateProduct}
        className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-7"
      >
        <input type="hidden" name="product_id" value={product.id} />

        <label className="block text-sm text-zinc-300">
          Nombre
          <input
            name="name"
            required
            defaultValue={product.name}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

        <ProductFormFields
          disciplines={disciplines ?? []}
          initialProductType={product.product_type}
          initialPrice={product.price_minor / 100}
          initialValidityDays={product.validity_days}
          initialCreditLimit={product.credit_limit}
          initialUnlimited={product.unlimited}
          selectedDisciplineIds={selectedDisciplineIds}
        />

        <label className="block text-sm text-zinc-300">
          Descripción
          <textarea
            name="description"
            rows={3}
            defaultValue={product.description ?? ""}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
          />
        </label>

        <div className="flex justify-end">
          <button className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
            Guardar cambios
          </button>
        </div>
      </form>
    </main>
  );
}
