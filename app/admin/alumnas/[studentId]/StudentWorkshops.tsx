import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { WorkshopPaymentForm } from "./WorkshopPaymentForm";
import { WorkshopWithdrawal } from "./WorkshopWithdrawal";
type Purchase = {
  id: string;
  offerId: string;
  title: string;
  saleId: string;
  selectionMode: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  dueAt: string | null;
  status: string;
  continuation: string | null;
  sessions: { id: string; startsAt: string; status: string }[];
};
const statusCopy: Record<string, string> = {
  reserved: "Reservado",
  cancelled: "Baja registrada",
  released: "Reservas liberadas",
  pending_payment: "Pago pendiente",
};
const attendanceCopy: Record<string, string> = {
  reserved: "Reservada",
  attended: "Asistió",
  no_show: "No asistió",
  cancelled: "Cancelada",
  cancelled_by_studio: "Cancelada por el estudio",
  cancelled_on_time: "Cancelada a tiempo",
  cancelled_late: "Cancelada fuera de plazo",
};
export async function StudentWorkshops({
  studentId,
  showEmpty = true,
}: {
  studentId: string;
  showEmpty?: boolean;
}) {
  const ctx = await getAdminContext("students.read");
  if (!ctx.can("sales.read")) return null;
  const response = await ctx.supabase.rpc("admin_student_workshops", {
    p_studio_id: ctx.studio.id,
    p_student_id: studentId,
  });
  if (response.error || !Array.isArray(response.data))
    return (
      <section className="profile360-view-panel">
        <h2>Talleres</h2>
        <p role="alert">No pudimos cargar las compras de talleres. Vuelve a intentarlo.</p>
      </section>
    );
  const purchases = response.data as Purchase[];
  if (!purchases.length && !showEmpty) return null;
  const money = (value: number) =>
    new Intl.NumberFormat(ctx.studio.locale, {
      style: "currency",
      currency: ctx.studio.currency,
    }).format(value / 100);
  const date = (value: string) =>
    new Intl.DateTimeFormat(ctx.studio.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: ctx.studio.timezone,
    }).format(new Date(value));
  return (
    <section className="profile360-view-panel profile360-workshops">
      <div className="profile360-workshops-heading">
        <div>
          <p className="eyebrow">TALLERES</p>
          <h2>Compras y saldo</h2>
          <p>Revisa fechas, pagos pendientes y acciones de cada taller.</p>
        </div>
        <span className="profile360-workshops-count">{purchases.length}</span>
      </div>
      {!purchases.length ? (
        <p className="profile360-workshops-empty">No hay compras de talleres registradas.</p>
      ) : (
        <div className="profile360-workshops-list">
          {purchases.map((p) => (
            <article key={p.id} className="profile360-workshop-card">
              <div className="profile360-workshop-title-row">
                <div>
                  <span className="profile360-workshop-type">
                    {p.selectionMode === "full" ? "Taller completo" : "Fechas individuales"}
                  </span>
                  <h3>
                    <Link href={`/admin/actividades/talleres/${p.offerId}`}>{p.title}</Link>
                  </h3>
                </div>
                <span className={`profile360-workshop-status is-${p.status}`}>
                  {statusCopy[p.status] ?? p.status}
                </span>
              </div>

              <div className="profile360-workshop-money-grid">
                <div>
                  <span>Total</span>
                  <strong>{money(p.totalMinor)}</strong>
                </div>
                <div>
                  <span>Pagado</span>
                  <strong>{money(p.paidMinor)}</strong>
                </div>
                <div className={p.balanceMinor > 0 ? "is-balance" : "is-paid"}>
                  <span>Saldo</span>
                  <strong>{money(p.balanceMinor)}</strong>
                </div>
              </div>

              {p.dueAt && p.balanceMinor > 0 ? (
                <div className="profile360-workshop-due">
                  <span>Vencimiento</span>
                  <strong>{date(p.dueAt)}</strong>
                </div>
              ) : null}

              <div className="profile360-workshop-sessions">
                <span className="profile360-workshop-section-label">Fechas reservadas</span>
                <div>
                  {p.sessions.map((s) => (
                    <article key={s.id}>
                      <span>{date(s.startsAt)}</span>
                      <strong>{attendanceCopy[s.status] ?? s.status}</strong>
                    </article>
                  ))}
                </div>
              </div>

              <div className="profile360-workshop-actions">
                {p.balanceMinor > 0 && ctx.can("sales.write") ? (
                  <WorkshopPaymentForm
                    purchaseId={p.id}
                    studentId={studentId}
                    balanceMinor={p.balanceMinor}
                    currency={ctx.studio.currency}
                    locale={ctx.studio.locale}
                  />
                ) : (
                  <Link
                    className="profile360-workshop-payment is-secondary"
                    href={`/admin/ventas/${p.saleId}`}
                  >
                    Ver venta y pagos
                  </Link>
                )}
                {p.status === "reserved" && ctx.can("sales.write") && ctx.can("schedule.write") ? (
                  <WorkshopWithdrawal purchaseId={p.id} requestId={randomUUID()} />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
