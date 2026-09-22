import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

type NotificationPayload = {
  session_id?: string;
  activity?: string;
  starts_at?: string;
  minimum_required?: number;
  reservations_at_review?: number;
  credit_restored?: boolean;
  credits_returned_total?: number;
  reason?: string;
};

export default async function StudentNotificationDetailPage({
  params,
}: {
  params: Promise<{ notificationId: string }>;
}) {
  const { notificationId } = await params;
  const { supabase, snapshot, studio } = await getStudentPortalContext();

  const { data: notification } = await supabase
    .from("app_notifications")
    .select("id,title,body,notification_type,created_at,read_at,payload")
    .eq("id", notificationId)
    .eq("student_id", snapshot.profile.student_id)
    .eq("recipient_kind", "student")
    .maybeSingle();

  if (!notification) notFound();

  await supabase.rpc("mark_my_app_notification_read", {
    p_notification_id: notification.id,
  });

  const payload = (notification.payload ?? {}) as NotificationPayload;
  const startsAt = payload.starts_at
    ? formatDateTime(payload.starts_at, studio.timezone)
    : null;

  return (
    <main className="mx-auto max-w-xl space-y-4 pb-6">
      <Link
        href="/student"
        className="inline-flex items-center text-xs font-semibold text-zinc-400 transition hover:text-white"
      >
        ← Inicio
      </Link>

      <section className="relative overflow-hidden rounded-[28px] border border-rose-500/35 bg-[radial-gradient(circle_at_88%_0%,rgba(244,63,94,0.18),transparent_38%),rgba(255,255,255,0.025)] p-5 shadow-[0_0_32px_rgba(244,63,94,0.08)]">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 to-fuchsia-500"
        />
        <span className="inline-flex rounded-full border border-rose-400/30 bg-rose-400/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-rose-200">
          Clase cancelada
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          {notification.title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{notification.body}</p>

        <div className="mt-5 grid gap-2">
          {payload.activity ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Actividad</p>
              <p className="mt-1 text-sm font-semibold text-white">{payload.activity}</p>
            </div>
          ) : null}
          {startsAt ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Fecha y hora</p>
              <p className="mt-1 text-sm font-semibold text-white">{startsAt}</p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Mínimo requerido
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {payload.minimum_required ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Reservas al revisar
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {payload.reservations_at_review ?? "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
          <p className="text-sm font-semibold text-emerald-200">
            {payload.credit_restored === false
              ? "Tu reserva fue liberada."
              : "Tu crédito fue restaurado."}
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-100/70">
            Esta cancelación fue realizada por el estudio y no cuenta como cancelación tardía ni
            genera penalización.
          </p>
        </div>
      </section>
    </main>
  );
}
