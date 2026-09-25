import Link from "next/link";

import { formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

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

export default async function StudentNotificationsPage() {
  const { supabase, snapshot, studio } = await getStudentPortalContext();

  const { data: notifications } = await supabase
    .from("app_notifications")
    .select("id,title,body,notification_type,created_at,read_at")
    .eq("student_id", snapshot.profile.student_id)
    .eq("recipient_kind", "student")
    .order("created_at", { ascending: false })
    .limit(50);

  const items = notifications ?? [];
  const unread = items.filter((item) => !item.read_at).length;

  return (
    <main className="space-y-5 pb-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="student-page-title">Notificaciones</h1>
          <p className="student-body mt-2">
            Aquí puedes volver a consultar confirmaciones, recordatorios y avisos de Demeter.
          </p>
        </div>
        {unread > 0 ? (
          <span className="shrink-0 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/[0.09] px-3 py-1.5 text-xs font-semibold text-fuchsia-200">
            {unread} sin leer
          </span>
        ) : null}
      </header>

      {items.length ? (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <div className="divide-y divide-white/10">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/student/notificaciones/${item.id}`}
                className={
                  "group grid min-h-20 grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-4 transition sm:px-5 " +
                  (item.read_at ? "hover:bg-white/[0.025]" : "bg-white/[0.035] hover:bg-white/[0.05]")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "mt-2 h-2.5 w-2.5 rounded-full " +
                    (item.read_at ? "bg-zinc-700" : "bg-fuchsia-400")
                  }
                />

                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <strong
                      className={
                        "text-[15px] text-white " +
                        (item.read_at ? "font-medium" : "font-semibold")
                      }
                    >
                      {item.title}
                    </strong>
                    <span className="text-xs text-zinc-500">
                      {notificationLabel(item.notification_type)}
                    </span>
                  </span>
                  <span className="mt-1 block line-clamp-2 text-sm leading-6 text-zinc-400">
                    {item.body}
                  </span>
                  <span className="mt-2 block text-xs text-zinc-600">
                    {formatDateTime(item.created_at, studio.timezone)}
                  </span>
                </span>

                <span
                  aria-hidden="true"
                  className="pt-1 text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
                >
                  ›
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="student-card px-5 py-12 text-center">
          <span aria-hidden="true" className="text-3xl text-zinc-600">
            ◇
          </span>
          <h2 className="mt-3 text-lg font-semibold text-white">Todavía no tienes notificaciones</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-zinc-400">
            Cuando Demeter te envíe una confirmación, recordatorio o aviso importante aparecerá
            aquí.
          </p>
        </section>
      )}
    </main>
  );
}
