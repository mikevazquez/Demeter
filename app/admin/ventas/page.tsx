import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(value / 100);
}

function paymentState(total: number, paid: number, saleStatus: string) {
  if (saleStatus === "voided")
    return { label: "Anulada", className: "bg-rose-500/15 text-rose-300" };
  if (paid <= 0) return { label: "Pendiente", className: "bg-amber-500/15 text-amber-300" };
  if (paid < total) return { label: "Parcial", className: "bg-sky-500/15 text-sky-300" };
  return { label: "Pagada", className: "bg-emerald-500/15 text-emerald-300" };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const ctx = await getAdminContext(CAPABILITIES.SALES_READ);
  const params = await searchParams;
  const query = (params.q ?? "").trim().toLocaleLowerCase("es-MX");
  const statusFilter = params.status ?? "all";

  const { data: sales } = await ctx.supabase
    .from("sales")
    .select("id,student_id,folio,status,currency,total_minor,created_at")
    .eq("studio_id", ctx.studio.id)
    .order("created_at", { ascending: false });

  const saleIds = (sales ?? []).map((sale) => sale.id);
  const studentIds = [...new Set((sales ?? []).map((sale) => sale.student_id))];

  const [{ data: payments }, { data: students }] = await Promise.all([
    saleIds.length
      ? ctx.supabase.from("payments").select("sale_id,kind,amount_minor").in("sale_id", saleIds)
      : Promise.resolve({ data: [] as { sale_id: string; kind: string; amount_minor: number }[] }),
    studentIds.length
      ? ctx.supabase.from("students").select("id,full_name").in("id", studentIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const paidMap = new Map<string, number>();
  for (const payment of payments ?? []) {
    const current = paidMap.get(payment.sale_id) ?? 0;
    paidMap.set(
      payment.sale_id,
      current + (payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor),
    );
  }

  const visibleSales = (sales ?? []).filter((sale) => {
    const paid = paidMap.get(sale.id) ?? 0;
    const state = paymentState(sale.total_minor, paid, sale.status).label.toLocaleLowerCase(
      "es-MX",
    );
    const studentName = studentMap.get(sale.student_id) ?? "Alumna";
    const matchesQuery =
      !query ||
      sale.folio.toLocaleLowerCase("es-MX").includes(query) ||
      studentName.toLocaleLowerCase("es-MX").includes(query);
    const matchesStatus = statusFilter === "all" || state === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400">Comercial</p>
          <h1 className="text-3xl font-semibold text-white">Ventas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Total, pagos y saldo se registran por separado para conservar la historia real.
          </p>
        </div>
        {ctx.can(CAPABILITIES.SALES_WRITE) ? (
          <Link
            href="/admin/ventas/nueva"
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Nueva venta
          </Link>
        ) : null}
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_180px_auto]">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Buscar por folio o alumna"
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-fuchsia-500/60"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white"
        >
          <option value="all">Todos los estados</option>
          <option value="pagada">Pagada</option>
          <option value="parcial">Parcial</option>
          <option value="pendiente">Pendiente</option>
          <option value="anulada">Anulada</option>
        </select>
        <button className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white">
          Filtrar
        </button>
      </form>

      {!visibleSales.length ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <h2 className="font-semibold text-white">No hay ventas que mostrar</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Cuando registres una venta aparecerá aquí con su total, pagado y saldo.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="hidden grid-cols-[1.1fr_1.4fr_1fr_1fr_1fr_auto] gap-4 border-b border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 md:grid">
            <span>Folio</span>
            <span>Alumna</span>
            <span>Total</span>
            <span>Pagado</span>
            <span>Saldo</span>
            <span>Estado</span>
          </div>
          <div className="divide-y divide-white/10">
            {visibleSales.map((sale) => {
              const paid = paidMap.get(sale.id) ?? 0;
              const balance = Math.max(sale.total_minor - paid, 0);
              const state = paymentState(sale.total_minor, paid, sale.status);
              return (
                <Link
                  key={sale.id}
                  href={`/admin/ventas/${sale.id}`}
                  className="grid gap-2 px-5 py-4 transition hover:bg-white/[0.04] md:grid-cols-[1.1fr_1.4fr_1fr_1fr_1fr_auto] md:items-center md:gap-4"
                >
                  <strong className="text-sm text-white">{sale.folio}</strong>
                  <span className="text-sm text-zinc-300">
                    {studentMap.get(sale.student_id) ?? "Alumna"}
                  </span>
                  <span className="text-sm text-zinc-300">
                    {money(sale.total_minor, sale.currency)}
                  </span>
                  <span className="text-sm text-zinc-300">{money(paid, sale.currency)}</span>
                  <span className="text-sm font-medium text-white">
                    {money(balance, sale.currency)}
                  </span>
                  <span className={`w-fit rounded-full px-2.5 py-1 text-xs ${state.className}`}>
                    {state.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
