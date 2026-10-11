import { campaignWhatsAppReadiness } from "@/lib/notifications/campaign-readiness";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  CAMPAIGN_SEGMENTS,
  campaignState,
  type CampaignTracking,
} from "@/lib/notifications/campaigns";
import CampaignForm from "../CampaignForm";
import { cancelCampaign } from "../actions";

const errors: Record<string, string> = {
  campaign_name_required: "Ponle un nombre interno.",
  campaign_message_invalid: "Escribe un mensaje de 10 a 1024 caracteres.",
  campaign_readonly: "Esta campaña ya no se puede editar.",
  campaign_outside_window: "Fuera del horario no urgente; programa el envío.",
  campaign_push_unavailable: "Falta configurar Push o activarlo en Preferencias.",
  campaign_whatsapp_template_required: "WhatsApp requiere una plantilla de Marketing aprobada.",
  campaign_no_recipients: "No hay personas elegibles para esta audiencia.",
  campaign_already_queued: "La campaña ya pasó a la cola de envío y no se puede cancelar aquí.",
};
export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [{ campaignId }, query, ctx] = await Promise.all([
    params,
    searchParams,
    getAdminContext(CAPABILITIES.AUTOMATIONS_READ),
  ]);
  const isNew = campaignId === "nueva";
  if (isNew && !ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE)) notFound();
  const { data: existing } = isNew
    ? { data: null }
    : await ctx.supabase
        .from("notification_campaigns")
        .select("id,name,audience_key,channel_key,message,status,scheduled_at,queued_at")
        .eq("id", campaignId)
        .eq("studio_id", ctx.studio.id)
        .maybeSingle();
  if (!isNew && !existing) notFound();
  const campaign = existing ?? {
    id: undefined,
    name: "",
    audience_key: "all_eligible",
    channel_key: "inbox",
    message: "",
    status: "draft",
    scheduled_at: null,
    queued_at: null,
  };
  const audiences = Object.fromEntries(
    await Promise.all(
      CAMPAIGN_SEGMENTS.map(async ([key]) => {
        const { data } = await ctx.supabase.rpc("admin_campaign_audience", {
          p_studio_id: ctx.studio.id,
          p_segment: key,
        });
        return [key, data ?? { total: 0, eligible: 0, sample: null }];
      }),
    ),
  );
  const { data: tracking } = existing
    ? await ctx.supabase.rpc("admin_campaign_tracking", { p_campaign_id: campaignId })
    : { data: null };
  const stats = tracking as CampaignTracking | null;
  const whatsappReadiness = await campaignWhatsAppReadiness(ctx.studio.id, ctx.supabase);
  const canManage = ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE);
  return (
    <main className="portal-page">
      <Link href="/admin/comunicacion?tab=marketing" className="portal-back">
        ← Campañas
      </Link>
      <header className="portal-page-header">
        <div>
          <h1>{campaign.name || "Nueva campaña"}</h1>
          <p className="portal-muted">
            {CAMPAIGN_SEGMENTS.find(([key]) => key === campaign.audience_key)?.[1]}
          </p>
        </div>
        <span className="portal-badge">{campaignState(campaign.status, stats)}</span>
      </header>
      {query.error ? (
        <p role="alert" className="portal-callout">
          {errors[query.error] ??
            "No pudimos completar la acción. Revisa los datos e inténtalo de nuevo."}
        </p>
      ) : null}
      {query.saved ? (
        <p role="status" className="portal-callout">
          {query.saved === "cancelled"
            ? "Envío cancelado; quedó como borrador."
            : query.saved === "save"
              ? "Borrador guardado."
              : "Campaña programada. Las entregas se registrarán cuando el motor las procese."}
        </p>
      ) : null}
      {campaign.status === "queued" && stats ? (
        <>
          <div className="portal-stats-grid">
            {[
              ["Enviados", stats.sent],
              ["Respondieron después", stats.responded],
              ["Compraron después", stats.purchased],
              ["Pendientes", stats.pending],
            ].map(([label, value]) => (
              <div key={label} className="card">
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="portal-muted">
            Respuestas y compras son actividad posterior de las destinatarias; no demuestran
            atribución a la campaña.
          </p>
        </>
      ) : null}
      {campaign.status === "scheduled" && campaign.scheduled_at ? (
        <section className="card">
          <p>
            Se enviará el{" "}
            {new Intl.DateTimeFormat(ctx.studio.locale, {
              dateStyle: "long",
              timeStyle: "short",
              timeZone: ctx.studio.timezone,
            }).format(new Date(campaign.scheduled_at))}
            .
          </p>
          {canManage ? (
            <form action={cancelCampaign}>
              <input type="hidden" name="campaign_id" value={campaignId} />
              <button className="portal-button">Cancelar envío</button>
            </form>
          ) : null}
        </section>
      ) : null}
      <CampaignForm
        whatsappReady={whatsappReadiness.ready}
        templateName={whatsappReadiness.templateName}
        campaign={campaign}
        audiences={audiences}
        readOnly={!canManage || campaign.status !== "draft"}
      />
    </main>
  );
}
