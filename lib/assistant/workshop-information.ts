import "server-only";
import type { AssistantToolContext } from "./read-tools";

// Informational reads never accept a tenant, identity, price or bank account
// supplied by the model. Context recovery is atomic and read-only in PostgreSQL.
export async function getWorkshopInformation(ctx: AssistantToolContext) {
  const response = await ctx.supabase.rpc("service_demi_workshop_context", {
    p_studio: ctx.studio.id,
    p_conversation: ctx.conversationId ?? null,
  });
  const data = response.data;
  if (response.error || data?.ok !== true || !Array.isArray(data.workshops))
    return { ok: false, reason_code: "workshop_catalog_unavailable" };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.studio.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const workshops = data.workshops.map((offer: Record<string, unknown>) => ({
    ...offer,
    sessions: Array.isArray(offer.sessions)
      ? offer.sessions.map((session: Record<string, unknown>) => {
          const date = new Date(String(session.starts_at));
          if (!Number.isFinite(date.getTime())) return session;
          const parts = new Map(
            formatter.formatToParts(date).map((part) => [part.type, part.value]),
          );
          return {
            ...session,
            date_local: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
            starts_at_local: `${parts.get("hour")}:${parts.get("minute")}`,
          };
        })
      : [],
  }));
  return {
    ...data,
    timezone: ctx.studio.timezone,
    workshops,
    availability_is_guaranteed: false,
  };
}
