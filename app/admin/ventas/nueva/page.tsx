import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { createManualSaleAction } from "../actions";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(value / 100);
}

function localDateKey(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const termCopy: Record<string, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  custom: "Otra vigencia",
};

const errorCopy: Record<string, string> = {
  sale_invalid: "Selecciona alumna, al menos un producto, fecha de inicio y revisa el pago.",
  products_required: "Selecciona al menos un producto.",
  duplicate_product_line: "No se puede agregar dos veces el mismo producto en esta venta.",
  product_not_available: "Uno de los productos ya no está disponible.",
  product_validity_missing: "Uno de los productos no tiene una vigencia válida.",
  payment_exceeds_balance: "El pago inicial no puede ser mayor al total de la venta.",
  payment_method_required: "Selecciona un método cuando registres un pago inicial.",
  student_not_operable: "La alumna no está activa para realizar la venta.",
  enrollment_product_not_configured:
    "La inscripción seleccionada no corresponde a la política activa de este estudio.",
};

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const params = await searchParams;
  const defaultStartDate = localDateKey(ctx.studio.timezone ?? "America/Mexico_City");

  const [{ data: students }, { data: products }, { data: enrollmentPolicy }] = await Promise.all([
    ctx.supabase
      .from("students")
      .select("id,full_name,phone")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name"),
    ctx.supabase
      .from("product_templates")
      .select(
        "id,name,product_type,package_term,price_minor,currency,credit_limit,validity_days,unlimited",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("enrollment_policies")
      .select("enabled,enrollment_product_template_id")
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
  ]);

  const visibleProducts = (products ?? []).filter(
    (product) =>
      product.product_type !== "enrollment" ||
      (enrollmentPolicy?.enabled && enrollmentPolicy.enrollment_product_template_id === product.id),
  );

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/ventas" className="text-sm text-fuchsia-300 hover:text-fuchsia-200">
            ← Ventas
          </Link>
          <p className="mt-4 text-sm text-zinc-400">FL-12 · Venta manual</p>
          <h1 className="text-3xl font-semibold text-white">Nueva venta</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Al confirmar se crea una sola vez la adquisición o inscripción correspondiente. Los
            pagos posteriores no duplican derechos ni créditos.
          </p>
        </div>
      </header>

      {params.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[params.error] ??
            `No se pudo crear la venta: ${decodeURIComponent(params.error)}`}
        </div>
      ) : null}

      {!students?.length || !visibleProducts.length ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-6">
          <h2 className="font-semibold text-amber-100">Falta información para vender</h2>
          <p className="mt-2 text-sm text-amber-100/70">
            Necesitas al menos una alumna activa y un producto activo antes de confirmar una venta.
          </p>
        </section>
      ) : (
        <form action={createManualSaleAction} className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fuchsia-500/15 text-sm font-bold text-fuchsia-300">
                1
              </span>
              <div className="w-full">
                <h2 className="font-semibold text-white">Alumna</h2>
                <p className="mt-1 text-sm text-zinc-400">Selecciona a quién pertenece la venta.</p>
                <select
                  name="student_id"
                  required
                  defaultValue=""
                  className="mt-4 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-white"
                >
                  <option value="" disabled>
                    Selecciona una alumna
                  </option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name}
                      {student.phone ? ` · ${student.phone}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fuchsia-500/15 text-sm font-bold text-fuchsia-300">
                2
              </span>
              <div className="w-full">
                <h2 className="font-semibold text-white">Inicio del paquete</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Por defecto inicia hoy, pero puedes elegir otra fecha antes de crear la
                  adquisición.
                </p>
                <label className="mt-4 grid gap-1.5 text-sm text-zinc-300">
                  Fecha de inicio
                  <input
                    name="starts_on"
                    type="date"
                    required
                    defaultValue={defaultStartDate}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fuchsia-500/15 text-sm font-bold text-fuchsia-300">
                3
              </span>
              <div className="w-full">
                <h2 className="font-semibold text-white">Productos</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Puedes incluir más de un producto distinto. La inscripción sólo aparece cuando la
                  política del estudio está habilitada.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {visibleProducts.map((product) => (
                    <label
                      key={product.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 has-[:checked]:border-fuchsia-500/60 has-[:checked]:bg-fuchsia-500/[0.08]"
                    >
                      <input
                        name="product_id"
                        value={product.id}
                        type="checkbox"
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-white">{product.name}</span>
                        <span className="mt-1 block text-sm text-zinc-400">
                          {product.product_type === "enrollment"
                            ? `Inscripción · ${product.validity_days == null ? "Vitalicia" : `${product.validity_days} días`}`
                            : `${product.package_term ? `${termCopy[product.package_term] ?? "Otra vigencia"} · ` : ""}${product.unlimited ? "Ilimitado" : `${product.credit_limit ?? 0} créditos`} · ${product.validity_days} días`}
                        </span>
                        <strong className="mt-2 block text-sm text-fuchsia-200">
                          {money(product.price_minor, product.currency)}
                        </strong>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fuchsia-500/15 text-sm font-bold text-fuchsia-300">
                4
              </span>
              <div className="w-full">
                <h2 className="font-semibold text-white">Pago inicial</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Puede ser $0, parcial o total. Los pagos posteriores se agregan desde el detalle
                  de la venta.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-sm text-zinc-300">
                    Monto en MXN
                    <input
                      name="payment_amount"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm text-zinc-300">
                    Método
                    <select
                      name="payment_method"
                      defaultValue=""
                      className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-white"
                    >
                      <option value="">Sin pago inicial</option>
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="tarjeta">Tarjeta</option>
                      <option value="otro">Otro</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm text-zinc-300">
                    Referencia
                    <input
                      name="payment_reference"
                      placeholder="Opcional"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm text-zinc-300">
                    Notas
                    <input
                      name="payment_notes"
                      placeholder="Opcional"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-3">
            <Link
              href="/admin/ventas"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Confirmar venta
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
