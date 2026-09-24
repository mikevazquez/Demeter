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
    <main className="space-y-4 pb-4 sm:space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            Notificaciones
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Tus avisos
          </h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Consulta aquí los mensajes importantes que te ha enviado Demeter.
          </p>
        </div>
        {unread > 0 ? (
          <span className="shrink-0 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/[0.09] px-3 py-1.5 text-xs font-semibold text-fuchsia-200">
            {unread} sin leer
          </span>
        ) : null}
      </header>

      {items.length ? (
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
          <div className="divide-y divide-white/10">
            {items.map((item) => (
              <Link
                key={item.id}
                href={"/student/notificaciones/" + item.id}
                className={
                  "group grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-4 transition sm:px-5 " +
                  (item.read_at ? "hover:bg-white/[0.025]" : "bg-fuchsia-500/[0.035] hover:bg-fuchsia-500/[0.06]")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "mt-1 h-2.5 w-2.5 rounded-full " +
                    (item.read_at ? "bg-zinc-700" : "bg-fuchsia-400 shadow-[0_0_14px_rgba(244,114,182,0.7)]")
                  }
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="text-sm font-semibold text-white">{item.title}</strong>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
                      {notificationLabel(item.notification_type)}
                    </span>
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-zinc-400">
                    {item.body}
                  </span>
                  <span className="mt-2 block text-[10px] text-zinc-600">
                    {formatDateTime(item.created_at, studio.timezone)}
                  </span>
                </span>
                <span aria-hidden="true" className="pt-1 text-xl text-zinc-600 transition group-hover:text-fuchsia-300">
                  ›
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/[0.025] px-5 py-12 text-center">
          <span aria-hidden="true" className="text-3xl text-zinc-600">◇</span>
          <h2 className="mt-3 text-base font-semibold text-white">Todavía no tienes notificaciones</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-zinc-400">
            Cuando Demeter te envíe una confirmación, recordatorio o aviso importante aparecerá aquí.
          </p>
        </section>
      )}
    </main>
  );
}
