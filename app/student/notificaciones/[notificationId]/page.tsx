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
    case "session_minimum_cancelled":
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
      return "Aviso";
  }
}

function notificationAction(type: string) {
  switch (type) {
    case "reservation_confirmed":
    case "class_reminder":
    case "class_rescheduled":
    case "waitlist_promoted":
      return { href: "/student/mis-clases", label: "Ver mis clases" };
    case "reservation_cancelled":
    case "class_cancelled_student":
    case "session_minimum_cancelled":
      return { href: "/student/reservar", label: "Buscar otra clase" };
    case "evaluation_invitation":
    case "evaluation_scheduled":
    case "evaluation_completed":
      return { href: "/student/evaluaciones", label: "Ver nivel técnico" };
    default:
      return null;
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
  const action = notificationAction(notification.notification_type);

  return (
    <main className="mx-auto max-w-xl space-y-4 pb-6">
      <Link
        href="/student/notificaciones"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
      >
        <span aria-hidden="true">←</span>
        Notificaciones
      </Link>

      <section className="student-card p-5 sm:p-6">
        <span className="inline-flex rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-xs font-semibold text-zinc-400">
          {notificationLabel(notification.notification_type)}
        </span>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          {notification.title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{notification.body}</p>
        <p className="mt-3 text-xs text-zinc-600">
          {formatDateTime(notification.created_at, studio.timezone)}
        </p>

        {className || startsAt ? (
          <div className="mt-5 grid gap-2">
            {className ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-xs font-medium text-zinc-500">Clase</p>
                <p className="mt-1 text-sm font-semibold text-white">{className}</p>
              </div>
            ) : null}
            {startsAt ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-xs font-medium text-zinc-500">Fecha y hora</p>
                <p className="mt-1 text-sm font-semibold text-white">{startsAt}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {payload.credit_restored !== undefined ? (
          <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
            <p className="text-sm font-semibold text-emerald-200">
              {payload.credit_restored
                ? "✓ Tu clase fue devuelta a tu paquete."
                : "Tu reserva fue liberada."}
            </p>
          </div>
        ) : null}

        {action ? (
          <Link href={action.href} className="student-action-primary mt-5 w-full sm:w-auto">
            {action.label}
          </Link>
        ) : null}
      </section>
    </main>
  );
}
