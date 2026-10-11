"use server";
import { campaignWhatsAppReadiness } from "@/lib/notifications/campaign-readiness";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function tomorrowAtEleven(timeZone: string) {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const tomorrow = new Date(`${date}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const guess = new Date(`${tomorrow.toISOString().slice(0, 10)}T11:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return new Date(guess.getTime() - (local - guess.getTime())).toISOString();
}
export async function saveCampaign(form: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const id = String(form.get("campaign_id") ?? "").trim() || null;
  const { data, error } = await ctx.supabase.rpc("admin_save_campaign", {
    p_studio_id: ctx.studio.id,
    p_campaign_id: id,
    p_name: String(form.get("name") ?? ""),
    p_segment: String(form.get("audience") ?? "all_eligible"),
    p_channel: String(form.get("channel") ?? "inbox"),
    p_message: String(form.get("message") ?? ""),
  });
  if (error || !data)
    redirect(
      `/admin/comunicacion/campanas/${id ?? "nueva"}?error=${encodeURIComponent(error?.message ?? "campaign_save_failed")}`,
    );
  const intent = String(form.get("intent") ?? "save");
  if (intent === "send" || intent === "tomorrow") {
    if (String(form.get("channel")) === "whatsapp") {
      const readiness = await campaignWhatsAppReadiness(ctx.studio.id, ctx.supabase);
      const { error: cacheError } = await createServiceClient().rpc(
        "service_cache_campaign_whatsapp_readiness",
        {
          p_studio_id: ctx.studio.id,
          p_actor: ctx.user.id,
          p_template_name: readiness.templateName ?? "",
          p_ready: readiness.ready,
        },
      );
      if (!readiness.ready || cacheError)
        redirect(`/admin/comunicacion/campanas/${data}?error=campaign_whatsapp_template_required`);
    }
    const result = await ctx.supabase.rpc("admin_schedule_campaign", {
      p_campaign_id: data,
      p_scheduled_at:
        intent === "tomorrow"
          ? tomorrowAtEleven(ctx.studio.timezone ?? "America/Mexico_City")
          : null,
    });
    if (result.error)
      redirect(
        `/admin/comunicacion/campanas/${data}?error=${encodeURIComponent(result.error.message)}`,
      );
  }
  revalidatePath("/admin/comunicacion");
  redirect(`/admin/comunicacion/campanas/${data}?saved=${intent}`);
}
export async function cancelCampaign(form: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const id = String(form.get("campaign_id") ?? "");
  const { error } = await ctx.supabase.rpc("admin_cancel_campaign", { p_campaign_id: id });
  if (error)
    redirect(`/admin/comunicacion/campanas/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/comunicacion");
  redirect(`/admin/comunicacion/campanas/${id}?saved=cancelled`);
}
