import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function money(value: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function paymentState(
  collectibleTotal: number,
  grossPaid: number,
  refunded: number,
  saleStatus: string,
) {
  if (saleStatus === "voided") return { label: "Anulada", tone: "is-danger" };
  if (refunded > 0 && refunded >= grossPaid) return { label: "Reembolsada", tone: "is-danger" };
  if (refunded > 0) return { label: "Con reembolso", tone: "is-amber" };

  const netCollected = grossPaid - refunded;
  if (netCollected <= 0) return { label: "Pendiente", tone: "is-amber" };
  if (netCollected < collectibleTotal) return { label: "Parcial", tone: "is-blue" };
  return { label: "Pagada", tone: "is-green" };
}

function ReceiptIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="30"
      height="30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const ctx = await getAdminContext(CAPABILITIES.SALES_READ);
  const params = await searchParams;
  const query = (params.q ?? "").trim().toLocaleLowerCase(ctx.studio.locale);
  const statusFilter = params.status ?? "all";

  const { data: sales } = await ctx.supabase
    .from("sales")
    .select("id,student_id,folio,status,currency,total_minor,created_at")
    .eq("studio_id", ctx.studio.id)
    .order("created_at", { ascending: false });

  const saleIds = (sales ?? []).map((sale) => sale.id);
  const studentIds = [...new Set((sales ?? []).map((sale) => sale.student_id))];

  const [{ data: payments }, { data: students }, { data: lines }] = await Promise.all([
    saleIds.length
      ? ctx.supabase.from("payments").select("sale_id,kind,amount_minor").in("sale_id", saleIds)
      : Promise.resolve({ data: [] as { sale_id: string; kind: string; amount_minor: number }[] }),
    studentIds.length
      ? ctx.supabase.from("students").select("id,full_name").in("id", studentIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    saleIds.length
      ? ctx.supabase
          .from("sale_lines")
          .select("id,sale_id,line_total_minor,refunded_at")
          .in("sale_id", saleIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            sale_id: string;
            line_total_minor: number;
            refunded_at: string | null;
          }[],
        }),
  ]);

  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const grossPaidMap = new Map<string, number>();
  const refundMap = new Map<string, number>();
  const collectibleMap = new Map<string, number>();

  for (const payment of payments ?? []) {
    const target = payment.kind === "refund" ? refundMap : grossPaidMap;
    target.set(payment.sale_id, (target.get(payment.sale_id) ?? 0) + payment.amount_minor);
  }

  for (const line of lines ?? []) {
    if (!line.refunded_at) {
      collectibleMap.set(
        line.sale_id,
        (collectibleMap.get(line.sale_id) ?? 0) + line.line_total_minor,
      );
    }
  }

  const visibleSales = (sales ?? []).filter((sale) => {
    const grossPaid = grossPaidMap.get(sale.id) ?? 0;
    const refunded = refundMap.get(sale.id) ?? 0;
    const collectibleTotal = collectibleMap.get(sale.id) ?? sale.total_minor;
    const state = paymentState(collectibleTotal, grossPaid, refunded, sale.status).label
      .toLocaleLowerCase(ctx.studio.locale);
    const studentName = studentMap.get(sale.student_id) ?? "Alumna";
    const matchesQuery =
      !query ||
      sale.folio.toLocaleLowerCase(ctx.studio.locale).includes(query) ||
      studentName.toLocaleLowerCase(ctx.studio.locale).includes(query);
    const matchesStatus = statusFilter === "all" || state === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <main className="sales-v2">
      <header className="sales-v2-header">
        <div>
          <h1>Ventas</h1>
          <p>Registra cobros y consulta el estado real de cada venta.</p>
        </div>
        {ctx.can(CAPABILITIES.SALES_WRITE) ? (
          <Link href="/admin/ventas/nueva" className="sales-v2-primary">
            <span aria-hidden="true">＋</span> Nueva venta
          </Link>
        ) : null}
      </header>

      <form className="sales-v2-filters">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Buscar alumna o folio"
          aria-label="Buscar alumna o folio"
        />
        <select name="status" defaultValue={statusFilter} aria-label="Estado de pago">
          <option value="all">Todos</option>
          <option value="pagada">Pagadas</option>
          <option value="parcial">Parciales</option>
          <option value="pendiente">Pendientes</option>
          <option value="con reembolso">Con reembolso</option>
          <option value="reembolsada">Reembolsadas</option>
          <option value="anulada">Anuladas</option>
        </select>
        <button type="submit">Filtrar</button>
      </form>

      {!visibleSales.length ? (
        <section className="sales-v2-empty">
          <strong>No hay ventas que mostrar</strong>
          <p>Cuando registres una venta aparecerá aquí.</p>
        </section>
      ) : (
        <section className="sales-v2-list" aria-label="Ventas">
          {visibleSales.map((sale) => {
            const grossPaid = grossPaidMap.get(sale.id) ?? 0;
            const refunded = refundMap.get(sale.id) ?? 0;
            const netCollected = grossPaid - refunded;
            const collectibleTotal = collectibleMap.get(sale.id) ?? sale.total_minor;
            const balance = Math.max(collectibleTotal - netCollected, 0);
            const state = paymentState(collectibleTotal, grossPaid, refunded, sale.status);
            const createdAt = new Intl.DateTimeFormat(ctx.studio.locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: ctx.studio.timezone,
            }).format(new Date(sale.created_at));

            return (
              <Link key={sale.id} href={`/admin/ventas/${sale.id}`} className="sales-v2-card">
                <span className="sales-v2-card-icon">
                  <ReceiptIcon />
                </span>

                <span className="sales-v2-card-main">
                  <span className="sales-v2-card-title">
                    <strong>{studentMap.get(sale.student_id) ?? "Alumna"}</strong>
                    <small>{sale.folio}</small>
                  </span>
                  <span className="sales-v2-card-date">{createdAt}</span>

                  <span className="sales-v2-card-money">
                    <span>
                      <small>Total</small>
                      <strong>{money(collectibleTotal, sale.currency, ctx.studio.locale)}</strong>
                    </span>
                    <span>
                      <small>Pagado</small>
                      <strong>{money(netCollected, sale.currency, ctx.studio.locale)}</strong>
                    </span>
                    <span>
                      <small>Saldo</small>
                      <strong>{money(balance, sale.currency, ctx.studio.locale)}</strong>
                    </span>
                  </span>
                </span>

                <span className={`sales-v2-status ${state.tone}`}>{state.label}</span>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
