import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { formatTime } from "@/lib/coach/portal";

type NotificationPayload = {
  session_id?: string;
  activity?: string;
  starts_at?: string;
  minimum_required?: number;
  reservations_at_review?: number;
  reason?: string;
};

export default async function CoachNotificationDetailPage({
  params,
}: {
  params: Promise<{ notificationId: string }>;
}) {
  const { notificationId } = await params;
  const { supabase, studio, membership } = await getAdminContext(
    CAPABILITIES.SCHEDULE_READ,
  );

  if (membership.role !== "instructor") notFound();

  const { data: currentInstructor } = await supabase
    .from("instructors")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("person_id", membership.person_id)
    .eq("status", "active")
    .maybeSingle();

  if (!currentInstructor) notFound();

  const { data: notification } = await supabase
    .from("app_notifications")
    .select("id,title,body,notification_type,created_at,read_at,payload")
    .eq("id", notificationId)
    .eq("instructor_id", currentInstructor.id)
    .eq("recipient_kind", "instructor")
    .maybeSingle();

  if (!notification) notFound();

  await supabase.rpc("mark_my_app_notification_read", {
    p_notification_id: notification.id,
  });

  const payload = (notification.payload ?? {}) as NotificationPayload;
  const startsAt = payload.starts_at ? new Date(payload.starts_at) : null;
  const dateLabel = startsAt
    ? new Intl.DateTimeFormat("es-MX", {
        timeZone: studio.timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(startsAt)
    : null;
  const timeLabel = payload.starts_at
    ? formatTime(payload.starts_at, studio.timezone)
    : null;

  return (
    <main className="dashboard-shell space-y-5">
      <Link className="back-link compact" href="/admin/mis-clases">
        ← Mis clases
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-rose-500/35 bg-[radial-gradient(circle_at_88%_0%,rgba(244,63,94,0.16),transparent_38%),rgba(255,255,255,0.025)] p-5">
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
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">{notification.body}</p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Actividad</p>
            <p className="mt-1 text-sm font-semibold text-white">{payload.activity ?? "Clase"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Horario</p>
            <p className="mt-1 text-sm font-semibold capitalize text-white">
              {dateLabel ?? "—"}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </p>
          </div>
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

        <div className="mt-5 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.06] p-4">
          <p className="text-sm font-semibold text-fuchsia-200">No necesitas asistir.</p>
          <p className="mt-1 text-xs leading-5 text-fuchsia-100/70">
            La sesión fue cancelada automáticamente y ya no aparecerá como clase operable.
          </p>
        </div>
      </section>
    </main>
  );
}
