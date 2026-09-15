import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { refundSaleLineAction, registerSalePaymentAction, voidSaleAction } from "../actions";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(value / 100);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Activo",
    expired: "Vencido",
    cancelled: "Inactivo",
    refunded: "Reembolsado",
  };
  return labels[status] ?? status;
}

const errorCopy: Record<string, string> = {
  payment_invalid: "Revisa el monto y selecciona un método de pago.",
  payment_method_required: "Selecciona un método de pago.",
  payment_exceeds_balance: "El pago no puede ser mayor al saldo pendiente.",
  sale_already_paid: "Esta venta ya está liquidada.",
  sale_not_open: "Esta venta ya no acepta movimientos.",
  refund_invalid: "Completa monto, método, motivo y confirmación del reembolso.",
  refund_method_required: "Selecciona el método del reembolso.",
  refund_reason_required: "El motivo del reembolso es obligatorio.",
  refund_exceeds_line: "El monto supera lo reembolsable de este producto.",
  refund_exceeds_collected: "No puedes reembolsar más dinero del que se ha cobrado.",
  refund_future_reservations_exist:
    "Este paquete todavía sostiene reservas futuras. Cancela esas reservas antes de reembolsar.",
  void_invalid: "Escribe el motivo y confirma la anulación.",
  void_reason_required: "El motivo de anulación es obligatorio.",
  sale_has_unreturned_funds: "Primero reembolsa el dinero cobrado antes de anular la venta.",
  void_future_reservations_exist:
    "La venta tiene paquetes con reservas futuras. Cancélalas antes de anular.",
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
    ctx.supabase
      .from("students")
      .select("id,full_name,phone")
      .eq("id", sale.student_id)
      .maybeSingle(),
    ctx.supabase
      .from("sale_lines")
      .select(
        "id,product_template_id,product_name,quantity,unit_price_minor,line_total_minor,refunded_at,refund_reason",
      )
      .eq("sale_id", sale.id)
      .order("created_at"),
    ctx.supabase
      .from("payments")
      .select("id,sale_line_id,kind,amount_minor,method,reference,notes,reason,created_at")
      .eq("sale_id", sale.id)
      .order("created_at"),
  ]);

  const lineIds = (lines ?? []).map((line) => line.id);
  const [{ data: acquisitions }, { data: enrollments }] = lineIds.length
    ? await Promise.all([
        ctx.supabase
          .from("product_acquisitions")
          .select("id,sale_line_id,status,starts_on,expires_on,credit_limit,unlimited")
          .in("sale_line_id", lineIds),
        ctx.supabase
          .from("student_enrollments")
          .select("id,source_sale_line_id,status,starts_on,expires_on,refunded_at,refund_reason")
          .in("source_sale_line_id", lineIds),
      ])
    : [
        {
          data: [] as {
            id: string;
            sale_line_id: string | null;
            status: string;
            starts_on: string;
            expires_on: string;
            credit_limit: number | null;
            unlimited: boolean;
          }[],
        },
        {
          data: [] as {
            id: string;
            source_sale_line_id: string | null;
            status: string;
            starts_on: string;
            expires_on: string | null;
            refunded_at: string | null;
            refund_reason: string | null;
          }[],
        },
      ];

  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.sale_line_id, item]));
  const enrollmentMap = new Map(
    (enrollments ?? []).map((item) => [item.source_sale_line_id, item]),
  );
  const lineNameMap = new Map((lines ?? []).map((line) => [line.id, line.product_name]));
  const lineRefundMap = new Map<string, number>();
  let grossPaid = 0;
  let refunded = 0;

  for (const payment of payments ?? []) {
    if (payment.kind === "refund") {
      refunded += payment.amount_minor;
      if (payment.sale_line_id) {
        lineRefundMap.set(
          payment.sale_line_id,
          (lineRefundMap.get(payment.sale_line_id) ?? 0) + payment.amount_minor,
        );
      }
    } else {
      grossPaid += payment.amount_minor;
    }
  }

  const netCollected = grossPaid - refunded;
  const collectibleTotal = (lines ?? []).reduce(
    (sum, line) => sum + (line.refunded_at ? 0 : line.line_total_minor),
    0,
  );
  const balance = Math.max(collectibleTotal - netCollected, 0);
  const paymentState =
    sale.status === "voided"
      ? "Anulada"
      : refunded > 0
        ? refunded >= grossPaid && grossPaid > 0
          ? "Reembolsada"
          : "Con reembolso"
        : grossPaid >= sale.total_minor
          ? "Pagada"
          : grossPaid > 0
            ? "Parcial"
            : "Pendiente";
  const canWrite = ctx.can(CAPABILITIES.SALES_WRITE);

  const successCopy: Record<string, string> = {
    sale: "Venta confirmada y derecho comercial creado correctamente.",
    payment: "Pago registrado correctamente.",
    refund: "Reembolso registrado. El derecho asociado quedó inactivo y su historia se conservó.",
    void: "Venta anulada correctamente; su historia se conserva.",
  };

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/ventas" className="text-sm text-fuchsia-300 hover:text-fuchsia-200">
            ← Ventas
          </Link>
          <p className="mt-4 text-sm text-zinc-400">{sale.folio}</p>
          <h1 className="text-3xl font-semibold text-white">{student?.full_name ?? "Venta"}</h1>
          <p className="mt-1 text-sm text-zinc-400">{student?.phone ?? "Sin teléfono"}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white">
          {paymentState}
        </span>
      </header>

      {query.created ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {successCopy[query.created] ?? "Operación registrada correctamente."}
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[query.error] ??
            `No se pudo completar la operación: ${decodeURIComponent(query.error)}`}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-5">
        {[
          ["Total vendido", sale.total_minor],
          ["Cobrado", grossPaid],
          ["Reembolsado", refunded],
          ["Neto cobrado", netCollected],
          ["Saldo", balance],
        ].map(([label, value]) => (
          <article
            key={String(label)}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
          >
            <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
            <strong className="mt-2 block text-2xl text-white">
              {money(Number(value), sale.currency)}
            </strong>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-semibold text-white">Productos y derechos</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Un producto puede generar una adquisición de clases o un estado de inscripción; nunca
          ambos.
        </p>
        <div className="mt-4 divide-y divide-white/10">
          {(lines ?? []).map((line) => {
            const acquisition = acquisitionMap.get(line.id);
            const enrollment = enrollmentMap.get(line.id);
            const lineRefunded = lineRefundMap.get(line.id) ?? 0;
            const lineRefundRemaining = Math.max(line.line_total_minor - lineRefunded, 0);
            const refundableNow = Math.min(lineRefundRemaining, Math.max(netCollected, 0));
            const isRefunded = Boolean(line.refunded_at);
            const fulfillmentStatus = acquisition?.status ?? enrollment?.status;

            return (
              <div key={line.id} className="space-y-4 py-5">
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-white">{line.product_name}</strong>
                      {enrollment ? (
                        <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300">
                          Inscripción
                        </span>
                      ) : acquisition ? (
                        <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300">
                          Paquete / adquisición
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${isRefunded ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}
                      >
                        {isRefunded
                          ? "Reembolsado · Inactivo"
                          : statusLabel(fulfillmentStatus ?? "sin estado")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      {acquisition
                        ? `${acquisition.unlimited ? "Ilimitado" : `${acquisition.credit_limit ?? 0} créditos`} · ${acquisition.starts_on} → ${acquisition.expires_on}`
                        : enrollment
                          ? `Inscripción · ${enrollment.starts_on} → ${enrollment.expires_on ?? "sin vencimiento"}`
                          : "Derecho asociado no encontrado"}
                    </p>
                    {lineRefunded > 0 ? (
                      <p className="mt-1 text-xs text-rose-300">
                        Reembolsado en esta línea: {money(lineRefunded, sale.currency)}
                      </p>
                    ) : null}
                  </div>
                  <strong className="text-sm text-white">
                    {money(line.line_total_minor, sale.currency)}
                  </strong>
                </div>

                {canWrite && sale.status === "confirmed" && !isRefunded && refundableNow > 0 ? (
                  <details className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-rose-200">
                      Reembolsar este producto
                    </summary>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      El reembolso es manual en este MVP. Al confirmarlo, el paquete o inscripción
                      asociado queda inactivo. Los consumos previos se conservan como historial.
                    </p>
                    <form action={refundSaleLineAction} className="mt-4 grid gap-3 md:grid-cols-2">
                      <input type="hidden" name="sale_id" value={sale.id} />
                      <input type="hidden" name="sale_line_id" value={line.id} />
                      <label className="grid gap-1.5 text-sm text-zinc-300">
                        Monto a reembolsar
                        <input
                          name="refund_amount"
                          required
                          inputMode="decimal"
                          placeholder="0.00"
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                        />
                        <span className="text-xs text-zinc-500">
                          Máximo disponible ahora: {money(refundableNow, sale.currency)}
                        </span>
                      </label>
                      <label className="grid gap-1.5 text-sm text-zinc-300">
                        Método manual
                        <select
                          name="refund_method"
                          required
                          defaultValue="efectivo"
                          className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-white"
                        >
                          <option value="efectivo">Efectivo</option>
                          <option value="transferencia">Transferencia</option>
                          <option value="tarjeta_manual">Tarjeta · registro manual</option>
                          <option value="otro">Otro</option>
                        </select>
                      </label>
                      <label className="grid gap-1.5 text-sm text-zinc-300 md:col-span-2">
                        Motivo
                        <input
                          name="refund_reason"
                          required
                          placeholder="Motivo obligatorio"
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm text-zinc-300">
                        Referencia
                        <input
                          name="refund_reference"
                          placeholder="Opcional"
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm text-zinc-300">
                        Notas
                        <input
                          name="refund_notes"
                          placeholder="Opcional"
                          className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                        />
                      </label>
                      <label className="flex items-start gap-2 text-xs text-zinc-300 md:col-span-2">
                        <input
                          type="checkbox"
                          name="confirm_refund"
                          value="yes"
                          required
                          className="mt-0.5"
                        />
                        Confirmo que el dinero se devolverá manualmente y que el derecho de esta
                        línea dejará de poder utilizarse.
                      </label>
                      <div className="md:col-span-2 md:text-right">
                        <button
                          type="submit"
                          className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
                        >
                          Registrar reembolso
                        </button>
                      </div>
                    </form>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-semibold text-white">Historial comercial</h2>
        {!payments?.length ? (
          <p className="mt-4 text-sm text-zinc-500">Aún no hay pagos ni reembolsos registrados.</p>
        ) : (
          <div className="mt-4 divide-y divide-white/10">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="grid gap-2 py-3 md:grid-cols-[120px_1fr_auto] md:items-center"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {payment.kind === "refund" ? "Reembolso" : "Pago"}
                </span>
                <div>
                  <p className="text-sm text-zinc-300">
                    {payment.method}
                    {payment.sale_line_id
                      ? ` · ${lineNameMap.get(payment.sale_line_id) ?? "Producto"}`
                      : ""}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </p>
                  {payment.reason ? (
                    <p className="mt-0.5 text-xs text-zinc-400">Motivo: {payment.reason}</p>
                  ) : null}
                  <p className="text-xs text-zinc-500">
                    {new Intl.DateTimeFormat("es-MX", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: ctx.studio.timezone,
                    }).format(new Date(payment.created_at))}
                  </p>
                </div>
                <strong
                  className={payment.kind === "refund" ? "text-rose-300" : "text-emerald-300"}
                >
                  {payment.kind === "refund" ? "−" : "+"}
                  {money(payment.amount_minor, sale.currency)}
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {canWrite && sale.status === "confirmed" && balance > 0 ? (
        <section className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-5">
          <h2 className="font-semibold text-white">Registrar pago</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Saldo vigente: {money(balance, sale.currency)}. Las líneas reembolsadas ya no forman
            parte de lo pendiente por cobrar.
          </p>
          <form action={registerSalePaymentAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="sale_id" value={sale.id} />
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Monto en MXN
              <input
                name="payment_amount"
                required
                inputMode="decimal"
                placeholder="0.00"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
              />
            </label>
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Método
              <select
                name="payment_method"
                required
                defaultValue=""
                className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-white"
              >
                <option value="" disabled>
                  Selecciona método
                </option>
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
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
              />
            </label>
            <label className="grid gap-1.5 text-sm text-zinc-300">
              Notas
              <input
                name="payment_notes"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
              />
            </label>
            <div className="md:col-span-2 md:text-right">
              <button className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
                Registrar pago
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {canWrite && sale.status === "confirmed" ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="font-semibold text-white">Anular venta</h2>
          {netCollected > 0 ? (
            <p className="mt-2 text-sm text-zinc-400">
              Esta venta conserva {money(netCollected, sale.currency)} de dinero cobrado. Primero
              registra los reembolsos correspondientes.
            </p>
          ) : (
            <form action={voidSaleAction} className="mt-4 grid gap-3">
              <input type="hidden" name="sale_id" value={sale.id} />
              <label className="grid gap-1.5 text-sm text-zinc-300">
                Motivo de anulación
                <input
                  name="void_reason"
                  required
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
                />
              </label>
              <label className="flex items-start gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  name="confirm_void"
                  value="yes"
                  required
                  className="mt-0.5"
                />
                Confirmo que la venta se marcará como anulada y los derechos activos asociados se
                inactivarán sin borrar su historia.
              </label>
              <div className="text-right">
                <button className="rounded-xl border border-rose-500/40 px-5 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-500/10">
                  Anular venta
                </button>
              </div>
            </form>
          )}
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
