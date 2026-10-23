import type { SupabaseClient } from "@supabase/supabase-js";

// NEB-01-40 · Ventana de reserva de cada clase para Demi. Si la migración todavía no está
// aplicada (o falla la consulta), se regresa null y Demi usa su regla anterior: no reservar en
// los últimos 30 minutos.

export const DEMI_FALLBACK_CLOSE_MS = 30 * 60_000;

export type SessionBookingWindow = {
  opensAt: string | null;
  closesAt: string;
  /** Tiempo para cancelar de la actividad (o del estudio). */
  cancellationCutoffMinutes: number | null;
};

export async function loadSessionBookingWindows(
  supabase: SupabaseClient,
  studioId: string,
  sessionIds: string[],
): Promise<Map<string, SessionBookingWindow> | null> {
  if (!sessionIds.length) return new Map();
  try {
    let result = await supabase.rpc("service_session_booking_windows", {
      p_studio_id: studioId,
      p_session_ids: sessionIds,
    });
    if (result?.error) {
      result = await supabase.rpc("session_booking_windows", { p_session_ids: sessionIds });
    }
    if (!result || result.error || !Array.isArray(result.data)) return null;
    const map = new Map<string, SessionBookingWindow>();
    for (const row of result.data as Record<string, unknown>[]) {
      if (typeof row?.session_id !== "string" || typeof row.booking_closes_at !== "string") continue;
      map.set(row.session_id, {
        opensAt: typeof row.booking_opens_at === "string" ? row.booking_opens_at : null,
        closesAt: row.booking_closes_at,
        cancellationCutoffMinutes:
          typeof row.cancellation_cutoff_minutes === "number" ? row.cancellation_cutoff_minutes : null,
      });
    }
    return map;
  } catch {
    return null;
  }
}

export type SessionBookingState = "open" | "not_open" | "closed";

export function sessionBookingState(
  session: { status: string; starts_at: string },
  window: SessionBookingWindow | null | undefined,
  now = Date.now(),
): SessionBookingState {
  if (session.status !== "scheduled") return "closed";
  if (!window) {
    return new Date(session.starts_at).getTime() > now + DEMI_FALLBACK_CLOSE_MS ? "open" : "closed";
  }
  if (window.opensAt && now < new Date(window.opensAt).getTime()) return "not_open";
  if (now >= new Date(window.closesAt).getTime()) return "closed";
  return "open";
}
