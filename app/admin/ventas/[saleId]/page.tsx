import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { registerSalePaymentAction } from "../actions";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(value / 100);
}

function paymentLabel(kind: string) {
  return kind === "refund" ? "Reembolso" : "Pago";
}

const errorCopy: Record<string, string> = {
  payment_invalid: "Revisa el monto y selecciona un método de pago.",
  payment_method_required: "Selecciona un método de pago.",
  payment_exceeds_balance: "El pago no puede ser mayor al saldo pendiente.",
  sale_already_paid: "Esta venta ya está liquidada.",
  sale_not_open: "Esta venta ya no acepta pagos.",
};

export default async function SaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ saleId: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const ctx = await getAdminContext(CAPABILITIES.SALES_READ);
  const { saleId } = await params;
  const query = await searchParams;

  const { data: sale } = await ctx.supabase
    .from("sales")
    .select("id,student_id,folio,status,currency,total_minor,void_reason,created_at")
    .eq("id", saleId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!sale) notFound();

  const [{ data: student }, { data: lines }, { data: payments }] = await Promise.all([
    ctx.supabase.from("students").select("id,full_name,phone").eq("id", sale.student_id).maybeSingle(),
    ctx.supabase
      .from("sale_lines")
      .select("id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor")
      .eq("sale_id", sale.id)
      .order("created_at"),
    ctx.supabase
      .from("payments")
      .select("id,kind,amount_minor,method,reference,notes,reason,created_at")
      .eq("sale_id", sale.id)
      .order("created_at"),
  ]);

  const lineIds = (lines ?? []).map((line) => line.id);
  const { data: acquisitions } = lineIds.length
    ? await ctx.supabase
        .from("product_acquisitions")
        .select("id,sale_line_id,status,starts_on,expires_on,credit_limit,unlimited")
        .in("sale_line_id", lineIds)
    : { data: [] as { id: string; sale_line_id: string | null; status: string; starts_on: string; expires_on: string; credit_limit: number | null; unlimited: boolean }[] };

  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.sale_line_id, item]));
  const paid = (payments ?? []).reduce(
    (sum, payment) => sum + (payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor),
    0,
  );
  const balance = Math.max(sale.total_minor - paid, 0);
  const paymentState = sale.status === "voided" ? "Anulada" : paid >= sale.total_minor ? "Pagada" : paid > 0 ? "Parcial" : "Pendiente";
  const canWrite = ctx.can(CAPABILITIES.SALES_WRITE);

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/ventas" className="text-sm text-fuchsia-300 hover:text-fuchsia-200">← Ventas</Link>
          <p className="mt-4 text-sm text-zinc-400">{sale.folio}</p>
          <h1 className="text-3xl font-semibold text-white">{student?.full_name ?? "Venta"}</h1>
          <p className="mt-1 text-sm text-zinc-400">{student?.phone ?? "Sin teléfono"}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white">{paymentState}</span>
      </header>

      {query.created ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {query.created === "payment" ? "Pago registrado correctamente." : "Venta confirmada y adquisición creada correctamente."}
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[query.error] ?? `No se pudo completar la operación: ${decodeURIComponent(query.error)}`}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Total</p>
          <strong className="mt-2 block text-2xl text-white">{money(sale.total_minor, sale.currency)}</strong>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Pagado neto</p>
          <strong className="mt-2 block text-2xl text-white">{money(paid, sale.currency)}</strong>
        </article>
        <article className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-5">
          <p className="text-xs uppercase tracking-wide text-fuchsia-300/70">Saldo</p>
          <strong className="mt-2 block text-2xl text-white">{money(balance, sale.currency)}</strong>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-semibold text-white">Productos y adquisiciones</h2>
        <div className="mt-4 divide-y divide-white/10">
          {(lines ?? []).map((line) => {
            const acquisition = acquisitionMap.get(line.id);
            return (
              <div key={line.id} className="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <strong className="text-white">{line.product_name}</strong>
                  <p className="mt-1 text-sm text-zinc-400">
                    {acquisition
                      ? `${acquisition.unlimited ? "Ilimitado" : `${acquisition.credit_limit ?? 0} créditos`} · ${acquisition.starts_on} → ${acquisition.expires_on}`
                      : "Adquisición no encontrada"}
                  </p>
                </div>
                <strong className="text-sm text-white">{money(line.line_total_minor, sale.currency)}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white">Historial de pagos</h2>
            <p className="mt-1 text-sm text-zinc-400">Cada pago queda como movimiento independiente.</p>
          </div>
        </div>
        {!payments?.length ? (
          <p className="mt-4 rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">Aún no hay pagos registrados.</p>
        ) : (
          <div className="mt-4 divide-y divide-white/10">
            {payments.map((payment) => (
              <div key={payment.id} className="grid gap-2 py-3 md:grid-cols-[110px_1fr_auto] md:items-center">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{paymentLabel(payment.kind)}</span>
                <div>
                  <p className="text-sm text-zinc-300">{payment.method}{payment.reference ? ` · ${payment.reference}` : ""}</p>
                  <p className="text-xs text-zinc-500">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.studio.timezone }).format(new Date(payment.created_at))}</p>
                </div>
                <strong className={payment.kind === "refund" ? "text-rose-300" : "text-emerald-300"}>
                  {payment.kind === "refund" ? "−" : "+"}{money(payment.amount_minor, sale.currency)}
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {canWrite && sale.status === "confirmed" && balance > 0 ? (
        <section className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-5">
          <h2 className="font-semibold text-white">Registrar pago</h2>
          <p className="mt-1 text-sm text-zinc-400">Saldo actual: {money(balance, sale.currency)}. Registrar otro pago no crea otra adquisición.</p>
          <form action={registerSalePaymentAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="sale_id" value={sale.id} />
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Monto en MXN
              <input name="payment_amount" required inputMode="decimal" placeholder="0.00" className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white" />
            </label>
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Método
              <select name="payment_method" required defaultValue="" className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-white">
                <option value="" disabled>Selecciona método</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Referencia
              <input name="payment_reference" placeholder="Opcional" className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white" />
            </label>
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Notas
              <input name="payment_notes" placeholder="Opcional" className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white" />
            </label>
            <div className="md:col-span-2 md:text-right">
              <button type="submit" className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">Registrar pago</button>
            </div>
          </form>
        </section>
      ) : null}

      {sale.status === "voided" && sale.void_reason ? (
        <section className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-5 text-sm text-rose-100">
          Venta anulada: {sale.void_reason}
        </section>
      ) : null}
    </main>
  );
}
