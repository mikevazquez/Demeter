import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { duplicateProduct, setProductActive } from "../actions";

const labels: Record<string, string> = {
  package: "Paquete",
  membership: "Membresía",
  single_class: "Clase suelta",
  enrollment: "Inscripción",
  other: "Otro",
};

type ProductDiscipline = {
  disciplines: { name: string }[];
};

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { productId } = await params;
  const { status } = await searchParams;
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
  const isEnrollment = product.product_type === "enrollment";
  const validityLabel =
    product.validity_days == null ? "Vitalicia" : `${product.validity_days} días`;
  const statusMessage =
    status === "activated"
      ? "Producto activado correctamente. Ya está disponible para su uso."
      : status === "deactivated"
        ? "Producto desactivado correctamente. Ya no está disponible para nuevas operaciones."
        : null;

  return (
    <main className="dashboard-shell admin-ux04-secondary-detail product-detail-page">
      {statusMessage ? (
        <section
          role="status"
          className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200"
        >
          ✓ {statusMessage}
        </section>
      ) : null}
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
            {new Intl.NumberFormat(ctx.studio.locale, {
              style: "currency",
              currency: product.currency,
            }).format(product.price_minor / 100)}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs text-zinc-500">{isEnrollment ? "Tipo de derecho" : "Créditos"}</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {isEnrollment
              ? "Administrativo"
              : product.unlimited
                ? "Ilimitados"
                : product.credit_limit}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs text-zinc-500">Vigencia</p>
          <p className="mt-2 text-xl font-semibold text-white">{validityLabel}</p>
        </div>
      </section>

      {!isEnrollment ? (
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
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-semibold text-white">Reglas</h2>
        <p className="mt-2 text-sm text-zinc-400">
          {isEnrollment
            ? product.validity_days == null
              ? "Al venderse crea una inscripción vitalicia, sin fecha de vencimiento. No otorga clases, créditos ni acceso a disciplinas."
              : `Al venderse crea una inscripción vigente durante ${product.validity_days} días. No otorga clases, créditos ni acceso a disciplinas.`
            : product.unlimited
              ? `Acceso ilimitado durante ${product.validity_days} días.`
              : `${product.credit_limit} créditos disponibles durante ${product.validity_days} días desde el inicio de la adquisición.`}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {isEnrollment
            ? "La política del estudio decide cuándo la inscripción es obligatoria para reservar."
            : "Los movimientos de crédito se registran en ledger; reservas y asistencia conservan sus efectos históricos."}
        </p>
      </section>

      {ctx.can("products.write") ? (
        <section className="flex flex-wrap gap-3">
          <Link
            href={`/admin/productos/${product.id}/editar`}
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Editar producto
          </Link>
          <form action={duplicateProduct}>
            <input type="hidden" name="product_id" value={product.id} />
            <button className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/[0.05]">
              Duplicar
            </button>
          </form>
          <form action={setProductActive}>
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="active" value={product.active ? "false" : "true"} />
            <button className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/[0.05]">
              {product.active ? "Desactivar producto" : "Reactivar producto"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
