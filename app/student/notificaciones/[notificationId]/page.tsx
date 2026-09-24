import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

type NotificationPayload = {
  activity?: string;
  class_name?: string;
  starts_at?: string;
  session_starts_at?: string;
  credit_restored?: boolean;
  credits_returned_total?: number;
  reason?: string;
};

function notificationLabel(type: string) {
  switch (type) {
    case "reservation_confirmed":
      return "Reserva confirmada";
    case "reservation_cancelled":
      return "Reserva cancelada";
    case "class_reminder":
      return "Recordatorio";
    case "class_cancelled_student":
      return "Clase cancelada";
    case "class_rescheduled":
      return "Cambio de horario";
    case "waitlist_promoted":
      return "Lugar disponible";
    case "evaluation_invitation":
      return "Evaluación";
    case "evaluation_scheduled":
      return "Evaluación programada";
    case "evaluation_completed":
      return "Resultado disponible";
    default:
      return "Notificación";
  }
}

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
  const className = payload.activity ?? payload.class_name ?? null;
  const rawStartsAt = payload.starts_at ?? payload.session_starts_at ?? null;
  const startsAt = rawStartsAt ? formatDateTime(rawStartsAt, studio.timezone) : null;

  return (
    <main className="mx-auto max-w-xl space-y-4 pb-6">
      <Link
        href="/student/notificaciones"
        className="inline-flex items-center text-xs font-semibold text-zinc-400 transition hover:text-white"
      >
        ← Notificaciones
      </Link>

      <section className="relative overflow-hidden rounded-[28px] border border-fuchsia-500/30 bg-[radial-gradient(circle_at_88%_0%,rgba(236,72,153,0.17),transparent_38%),rgba(255,255,255,0.025)] p-5 shadow-[0_0_32px_rgba(236,72,153,0.07)]">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-fuchsia-500 to-violet-500"
        />
        <span className="inline-flex rounded-full border border-fuchsia-400/25 bg-fuchsia-400/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-fuchsia-200">
          {notificationLabel(notification.notification_type)}
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          {notification.title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{notification.body}</p>
        <p className="mt-3 text-[10px] text-zinc-600">
          {formatDateTime(notification.created_at, studio.timezone)}
        </p>

        {className || startsAt ? (
          <div className="mt-5 grid gap-2">
            {className ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Clase</p>
                <p className="mt-1 text-sm font-semibold text-white">{className}</p>
              </div>
            ) : null}
            {startsAt ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  Fecha y hora
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{startsAt}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {payload.credit_restored !== undefined ? (
          <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
            <p className="text-sm font-semibold text-emerald-200">
              {payload.credit_restored ? "Tu crédito fue restaurado." : "Tu reserva fue liberada."}
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
