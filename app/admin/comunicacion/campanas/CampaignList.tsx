import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  CAMPAIGN_SEGMENTS,
  campaignState,
  type CampaignTracking,
} from "@/lib/notifications/campaigns";
export default async function CampaignList() {
  const ctx = await getAdminContext(CAPABILITIES.AUTOMATIONS_READ);
  const { data: campaigns, error } = await ctx.supabase
    .from("notification_campaigns")
    .select("id,name,audience_key,channel_key,status,scheduled_at,created_at")
    .eq("studio_id", ctx.studio.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const tracking = new Map(
    await Promise.all(
      (campaigns ?? []).map(async (campaign) => {
        const { data } = await ctx.supabase.rpc("admin_campaign_tracking", {
          p_campaign_id: campaign.id,
        });
        return [campaign.id, data as CampaignTracking | null] as const;
      }),
    ),
  );
  return (
    <section className="portal-campaigns">
      <header className="portal-row">
        <p className="portal-muted">
          Mensajes puntuales a un segmento. Respetan el horario no urgente, las preferencias y el
          límite comercial de cada alumna.
        </p>
        {ctx.can(CAPABILITIES.AUTOMATIONS_MANAGE) ? (
          <Link href="/admin/comunicacion/campanas/nueva" className="portal-button is-primary">
            ＋ Nueva
          </Link>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="portal-empty">
          No pudimos cargar las campañas. Intenta nuevamente.
        </p>
      ) : campaigns?.length ? (
        <div className="portal-list">
          {campaigns.map((campaign) => {
            const stats = tracking.get(campaign.id);
            return (
              <Link
                href={`/admin/comunicacion/campanas/${campaign.id}`}
                className="portal-more-row"
                key={campaign.id}
              >
                <span className="portal-more-icon is-violet">📨</span>
                <span className="portal-more-copy">
                  <strong>{campaign.name}</strong>
                  <small>
                    {CAMPAIGN_SEGMENTS.find(([key]) => key === campaign.audience_key)?.[1]} ·{" "}
                    {campaign.channel_key === "inbox"
                      ? "Inbox"
                      : campaign.channel_key === "push"
                        ? "Push"
                        : "WhatsApp"}
                  </small>
                  <span className="portal-badge">
                    {campaignState(campaign.status, stats)}
                    {campaign.status === "queued" && stats
                      ? ` · ${stats.sent} enviados · ${stats.purchased} compraron después`
                      : ""}
                  </span>
                  {campaign.status === "scheduled" && campaign.scheduled_at ? (
                    <small>
                      {new Intl.DateTimeFormat(ctx.studio.locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: ctx.studio.timezone,
                      }).format(new Date(campaign.scheduled_at))}
                    </small>
                  ) : null}
                </span>
                <span>›</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card portal-empty">
          Aún no hay campañas. Crea un borrador para preparar tu primer mensaje.
        </div>
      )}
    </section>
  );
}
