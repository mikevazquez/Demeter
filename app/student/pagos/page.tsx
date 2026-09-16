import { formatDateTime, formatMoney, getStudentPortalContext } from "@/lib/student/portal";

export default async function StudentPaymentsPage() {
  const { snapshot, studio } = await getStudentPortalContext();

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Pagos</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">Tu historial de pagos</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Consulta pagos y reembolsos registrados en tus ventas del estudio.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        {snapshot.payments.length ? (
          <div className="divide-y divide-white/10">
            {snapshot.payments.map((payment) => {
              const refund = payment.kind === "refund";
              return (
                <article
                  key={payment.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">{payment.folio}</p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          refund
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {refund ? "Reembolso" : "Pago"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      {formatDateTime(payment.created_at, studio.timezone)} · {payment.method}
                    </p>
                    {payment.reference ? (
                      <p className="mt-1 text-xs text-zinc-500">Referencia: {payment.reference}</p>
                    ) : null}
                  </div>
                  <strong className={refund ? "text-rose-300" : "text-white"}>
                    {refund ? "−" : ""}
                    {formatMoney(payment.amount_minor, payment.currency)}
                  </strong>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
            <h2 className="font-semibold text-white">Todavía no hay pagos registrados</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Cuando el estudio registre un pago o reembolso aparecerá aquí.
            </p>
          </div>
        )}
      </section>

      <p className="text-xs leading-5 text-zinc-500">
        Este historial refleja los movimientos comerciales guardados en Studio Flow. La generación de comprobantes descargables no forma parte de F10 y no se simula en esta pantalla.
      </p>
    </main>
  );
}
