import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
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
export async function StudentWorkshops({ studentId }: { studentId: string }) {
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
    <section className="profile360-view-panel">
      <h2>Talleres: compras, fechas y saldo</h2>
      {!purchases.length ? (
        <p>No hay compras de talleres registradas.</p>
      ) : (
        purchases.map((p) => (
          <article key={p.id} className="profile360-sale-history-item">
            <h3>
              <Link href={`/admin/actividades/talleres/${p.offerId}`}>{p.title}</Link>
            </h3>
            <p>
              {p.selectionMode === "full" ? "Taller completo" : "Fechas individuales"} ·{" "}
              {statusCopy[p.status] ?? p.status}
            </p>
            <p>
              Total {money(p.totalMinor)} · Pagado {money(p.paidMinor)} · Saldo{" "}
              {money(p.balanceMinor)}
            </p>
            {p.dueAt && p.balanceMinor > 0 ? <p>Vencimiento: {date(p.dueAt)}</p> : null}
            <ul>
              {p.sessions.map((s) => (
                <li key={s.id}>
                  {date(s.startsAt)} · {attendanceCopy[s.status] ?? s.status}
                </li>
              ))}
            </ul>
            <Link href={`/admin/ventas/${p.saleId}`}>Ver venta y pagos</Link>
            {p.status === "reserved" && ctx.can("sales.write") && ctx.can("schedule.write") ? (
              <WorkshopWithdrawal purchaseId={p.id} requestId={randomUUID()} />
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}
