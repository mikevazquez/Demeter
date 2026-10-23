import "server-only";

import type { getAdminContext } from "@/lib/auth/admin-context";

/** P360-V2-08 · Clases de la persona agrupadas por paquete y su próxima clase reservada. */
export type PackageClassEvent = {
  id: string;
  acquisitionId: string | null;
  status: string;
  className: string;
  startsAt: string;
  cancelledAt: string | null;
  creditsHeld: number;
};

type ReservationRow = {
  id: string;
  session_id: string;
  acquisition_id: string | null;
  status: string;
  credits_held: number | null;
  cancelled_at: string | null;
};

export async function readClasses(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  studioId: string,
  reservationRows: ReservationRow[],
  currentAcquisitionId: string | null,
) {
  const packageClassEvents = new Map<string, PackageClassEvent[]>();
  const generalClassEvents: PackageClassEvent[] = [];

  let nextClass: { name: string; startsAt: string } | null = null;

  const allSessionIds = [...new Set(reservationRows.map((item) => item.session_id))];
  const { data: sessionRows } = allSessionIds.length
    ? await supabase
        .from("class_sessions")
        .select("id,template_id,starts_at")
        .eq("studio_id", studioId)
        .in("id", allSessionIds)
    : { data: [] };

  const templateIds = [...new Set((sessionRows ?? []).map((item) => item.template_id))];
  const { data: templateRows } = templateIds.length
    ? await supabase
        .from("class_templates")
        .select("id,name")
        .eq("studio_id", studioId)
        .in("id", templateIds)
    : { data: [] };

  const sessionMap = new Map((sessionRows ?? []).map((item) => [item.id, item]));
  const templateNameMap = new Map((templateRows ?? []).map((item) => [item.id, item.name]));

  for (const reservation of reservationRows) {
    const session = sessionMap.get(reservation.session_id);
    if (!session) continue;
    const event: PackageClassEvent = {
      id: reservation.id,
      acquisitionId: reservation.acquisition_id,
      status: reservation.status,
      className: templateNameMap.get(session.template_id) ?? "Clase",
      startsAt: session.starts_at,
      cancelledAt: reservation.cancelled_at,
      creditsHeld: reservation.credits_held ?? 0,
    };
    generalClassEvents.push(event);
    if (reservation.acquisition_id) {
      const list = packageClassEvents.get(reservation.acquisition_id) ?? [];
      list.push(event);
      packageClassEvents.set(reservation.acquisition_id, list);
    }
  }

  for (const events of packageClassEvents.values()) {
    events.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }
  generalClassEvents.sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  if (currentAcquisitionId) {
    const upcoming = (packageClassEvents.get(currentAcquisitionId) ?? [])
      .filter((event) => event.status === "reserved" && new Date(event.startsAt) > new Date())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    if (upcoming) {
      nextClass = { name: upcoming.className, startsAt: upcoming.startsAt };
    }
  }
  return { packageClassEvents, generalClassEvents, nextClass };
}
