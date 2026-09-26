import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { setEnrollmentPolicyAction } from "./actions";

const errorCopy: Record<string, string> = {
  enrollment_product_required:
    "Selecciona un producto de tipo Inscripción antes de habilitar la política.",
  enrollment_product_not_found: "El producto seleccionado ya no existe en este estudio.",
  enrollment_product_type_required: "El producto seleccionado debe ser de tipo Inscripción.",
  single_class_grace_invalid:
    "La cantidad de clases sueltas iniciales sin inscripción debe estar entre 0 y 100.",
};

export default async function EnrollmentPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const ctx = await getAdminContext(CAPABILITIES.SALES_READ);
  const query = await searchParams;
  const canConfigure = ctx.can(CAPABILITIES.SETTINGS_WRITE);

  const [{ data: policy }, { data: enrollmentProducts }] = await Promise.all([
    ctx.supabase
      .from("enrollment_policies")
      .select(
        "enabled,required_for_booking,required_for_package_purchase,required_for_single_class,single_class_grace_count,enrollment_product_template_id,rules",
      )
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("product_templates")
      .select("id,name,price_minor,currency,validity_days,active")
      .eq("studio_id", ctx.studio.id)
      .eq("product_type", "enrollment")
      .order("active", { ascending: false })
      .order("name"),
  ]);

  const selected = enrollmentProducts?.find(
    (product) => product.id === policy?.enrollment_product_template_id,
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/admin/ventas" className="text-sm text-fuchsia-300 hover:text-fuchsia-200">
          ← Ventas
        </Link>
        <p className="mt-4 text-sm text-zinc-400">SF-093 · Política por estudio</p>
        <h1 className="text-3xl font-semibold text-white">Inscripción</h1>
        <p className="mt-1 text-sm leading-6 text-zinc-400">
          Cada estudio define si utiliza inscripción, qué producto la cobra y en qué momentos debe
          exigirse. Las reglas se aplican por tenant, sin depender de reglas de un estudio concreto.
        </p>
      </header>

      {query.updated ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Política de inscripción actualizada.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[query.error] ?? `No se pudo guardar: ${decodeURIComponent(query.error)}`}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Estado</p>
          <strong className="mt-2 block text-lg text-white">
            {policy?.enabled ? "Habilitada" : "Deshabilitada"}
          </strong>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Para reservar</p>
          <strong className="mt-2 block text-lg text-white">
            {policy?.required_for_booking ? "Requerida" : "No requerida"}
          </strong>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Clases sueltas</p>
          <strong className="mt-2 block text-lg text-white">
            {policy?.required_for_single_class
              ? `Después de ${policy.single_class_grace_count ?? 0}`
              : "No requerida"}
          </strong>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Producto</p>
          <strong className="mt-2 block text-lg text-white">
            {selected?.name ?? "Sin asignar"}
          </strong>
        </article>
      </section>

      {!enrollmentProducts?.length ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-5">
          <h2 className="font-semibold text-amber-100">Primero crea el producto de inscripción</h2>
          <p className="mt-2 text-sm text-amber-100/70">
            En Productos crea uno de tipo Inscripción. Su precio será el importe comercial y su
            vigencia en días definirá la fecha de vencimiento de la inscripción que se genere al
            venderlo.
          </p>
          <Link
            href="/admin/productos/nuevo"
            className="mt-4 inline-flex rounded-xl border border-amber-300/20 px-4 py-2 text-sm font-semibold text-amber-100"
          >
            Crear producto
          </Link>
        </section>
      ) : canConfigure ? (
        <form
          action={setEnrollmentPolicyAction}
          className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
        >
          <label className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={policy?.enabled ?? false}
              className="mt-0.5"
            />
            <span>
              <strong className="block text-white">Habilitar inscripción</strong>
              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                Permite vender el producto designado y generar/renovar un estado de inscripción para
                la alumna.
              </span>
            </span>
          </label>

          <label className="block text-sm text-zinc-300">
            Producto que representa la inscripción
            <select
              name="product_template_id"
              defaultValue={policy?.enrollment_product_template_id ?? ""}
              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-white"
            >
              <option value="">Sin asignar</option>
              {enrollmentProducts.map((product) => (
                <option key={product.id} value={product.id} disabled={!product.active}>
                  {product.name} ·{" "}
                  {new Intl.NumberFormat(ctx.studio.locale, {
                    style: "currency",
                    currency: product.currency,
                  }).format(product.price_minor / 100)}{" "}
                  · {product.validity_days == null ? "Vitalicia" : `${product.validity_days} días`}
                  {!product.active ? " · inactivo" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3">
            <label className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
              <input
                name="required_for_package_purchase"
                type="checkbox"
                defaultChecked={policy?.required_for_package_purchase ?? false}
                className="mt-0.5"
              />
              <span>
                <strong className="block text-white">
                  Exigir inscripción al comprar paquete o membresía
                </strong>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  La venta no puede completarse sin resolver la inscripción vigente.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm text-zinc-300">
              <input
                name="required_for_booking"
                type="checkbox"
                defaultChecked={policy?.required_for_booking ?? false}
                className="mt-0.5"
              />
              <span>
                <strong className="block text-white">
                  Exigir inscripción al reservar con paquete o membresía
                </strong>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  La inscripción debe seguir vigente en la fecha de la clase.
                </span>
              </span>
            </label>

            <div className="rounded-xl border border-white/10 p-4">
              <label className="flex items-start gap-3 text-sm text-zinc-300">
                <input
                  name="required_for_single_class"
                  type="checkbox"
                  defaultChecked={policy?.required_for_single_class ?? false}
                  className="mt-0.5"
                />
                <span>
                  <strong className="block text-white">
                    Exigir inscripción para clases sueltas
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">
                    Puedes permitir algunas compras iniciales antes de exigirla.
                  </span>
                </span>
              </label>

              <label className="mt-4 block text-sm text-zinc-300">
                Clases sueltas iniciales sin inscripción
                <input
                  name="single_class_grace_count"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  defaultValue={policy?.single_class_grace_count ?? 0}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                />
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  0 = exigir desde la primera. 1 = la primera clase suelta puede comprarse sin
                  inscripción; la segunda ya la requiere.
                </span>
              </label>
            </div>
          </div>

          <div className="text-right">
            <button className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
              Guardar política
            </button>
          </div>
        </form>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-400">
          Puedes consultar esta política, pero tu rol no tiene permiso para modificar configuración
          del estudio.
        </section>
      )}
    </main>
  );
}
