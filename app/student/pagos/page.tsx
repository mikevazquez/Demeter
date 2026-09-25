import Link from "next/link";

import { formatDateTime, formatMoney, getStudentPortalContext } from "@/lib/student/portal";

export default async function StudentPaymentsPage() {
  const { snapshot, studio } = await getStudentPortalContext();

  return (
    <main className="space-y-5 pb-6">
      <header>
        <Link
          href="/student/perfil"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Perfil
        </Link>
        <p className="student-eyebrow mt-3">Mi membresía</p>
        <h1 className="student-page-title mt-1">Mis pagos</h1>
        <p className="student-body mt-2">Consulta tus pagos y reembolsos registrados en Demeter.</p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
        {snapshot.payments.length ? (
          <div className="divide-y divide-white/10">
            {snapshot.payments.map((payment) => {
              const refund = payment.kind === "refund";

              return (
                <article
                  key={payment.id}
                  className="flex min-h-20 items-start justify-between gap-4 px-4 py-4 sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-semibold text-white">
                        {refund ? "Reembolso" : "Pago"}
                      </strong>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          refund
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {refund ? "Devuelto" : "Registrado"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      {formatDateTime(payment.created_at, studio.timezone)} · {payment.method}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      Folio {payment.folio}
                      {payment.reference ? ` · Ref. ${payment.reference}` : ""}
                    </p>
                  </div>

                  <strong className={refund ? "shrink-0 text-rose-300" : "shrink-0 text-white"}>
                    {refund ? "−" : ""}
                    {formatMoney(payment.amount_minor, payment.currency)}
                  </strong>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center">
            <h2 className="font-semibold text-white">Todavía no hay pagos registrados</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Cuando se registre un pago o reembolso aparecerá aquí.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
