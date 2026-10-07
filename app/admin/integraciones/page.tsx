import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import "./integrations-v2.css";

type StatusTone = "active" | "available" | "soon";

function IntegrationCard({
  mark,
  name,
  description,
  detail,
  status,
  tone,
  href,
}: {
  mark: string;
  name: string;
  description: string;
  detail: string;
  status: string;
  tone: StatusTone;
  href?: string;
}) {
  const content = (
    <>
      <span className="integrations-v2-mark" data-provider={mark.toLowerCase()}>
        {mark}
      </span>
      <span className="integrations-v2-copy">
        <strong>{name}</strong>
        <small>{description}</small>
        <span>{detail}</span>
      </span>
      <span className={`integrations-v2-status is-${tone}`}>{status}</span>
      <span className="integrations-v2-chevron" aria-hidden="true">
        {href ? "›" : ""}
      </span>
    </>
  );

  return href ? (
    <Link href={href} className="integrations-v2-card">
      {content}
    </Link>
  ) : (
    <article className="integrations-v2-card is-disabled">{content}</article>
  );
}

export default async function IntegrationsPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const [
    { count: asistianEvents },
    { count: asistianMappings },
    { count: mercadoPagoAttempts },
    { count: onlineProducts },
    { data: whatsappProvider },
    { data: metaInboxSummary },
    { data: demiConfig },
  ] = await Promise.all([
    supabase
      .from("asistian_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id),
    supabase
      .from("asistian_service_mappings")
      .select("asistian_service_id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("active", true),
    supabase
      .from("online_checkout_attempts")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("provider", "mercado_pago"),
    supabase
      .from("product_templates")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("online_purchasable", true),
    supabase
      .from("notification_studio_channel_providers")
      .select("provider_key,enabled,is_default")
      .eq("studio_id", studio.id)
      .eq("channel_key", "whatsapp")
      .eq("provider_key", "meta_whatsapp")
      .maybeSingle(),
    supabase.rpc("admin_get_meta_inbox_connection_summary", {
      target_studio_id: studio.id,
    }),
    supabase
      .from("assistant_configs")
      .select("assistant_name,mode,model")
      .eq("studio_id", studio.id)
      .maybeSingle(),
  ]);

  const asistianConnected = (asistianEvents ?? 0) > 0 || (asistianMappings ?? 0) > 0;
  const mercadoPagoInUse = (mercadoPagoAttempts ?? 0) > 0;
  const whatsappActive = Boolean(whatsappProvider?.enabled);
  const metaInboxConnected = Boolean(
    (metaInboxSummary as { connected?: boolean } | null)?.connected,
  );

  return (
    <main className="integrations-v2">
      <header className="integrations-v2-header">
        <div>
          <Link className="integrations-v2-back" href="/admin/mas">
            ← Más
          </Link>
          <h1>Integraciones</h1>
          <p>Conecta Studio Flow con los servicios externos que usa tu estudio.</p>
        </div>
      </header>

      <section className="integrations-v2-section">
        <div className="integrations-v2-section-heading">
          <div>
            <h2>Disponibles ahora</h2>
            <p>Conexiones que ya forman parte de Studio Flow.</p>
          </div>
        </div>

        <div className="integrations-v2-grid">
          <IntegrationCard
            mark="A"
            name="Asistian"
            description="Reservas, actividades y comunicación entre ambos sistemas."
            detail={`${asistianMappings ?? 0} actividades relacionadas · ${asistianEvents ?? 0} eventos recibidos`}
            status={asistianConnected ? "Conectado" : "Configurar"}
            tone={asistianConnected ? "active" : "available"}
            href="/admin/integraciones/asistian"
          />

          <IntegrationCard
            mark="MP"
            name="Mercado Pago"
            description="Cobros en línea para paquetes, clases y otros checkouts de alumnas."
            detail={`${onlineProducts ?? 0} productos disponibles online · ${mercadoPagoAttempts ?? 0} intentos de pago`}
            status={mercadoPagoInUse ? "En uso" : "Disponible"}
            tone={mercadoPagoInUse ? "active" : "available"}
            href="/admin/integraciones/mercado-pago"
          />

          <IntegrationCard
            mark="WA"
            name="Meta · WhatsApp"
            description="Mensajes y plantillas de WhatsApp para comunicación con alumnas."
            detail="La lógica de mensajes se administra desde Comunicación."
            status={whatsappActive ? "Activo" : "Disponible"}
            tone={whatsappActive ? "active" : "available"}
            href="/admin/integraciones/meta-whatsapp"
          />

          <IntegrationCard
            mark="D"
            name={demiConfig?.assistant_name ?? "Demi"}
            description="Instrucciones, mejoras con IA y pruebas de conversación."
            detail={
              demiConfig
                ? `${demiConfig.model} · modo ${demiConfig.mode}`
                : "Configura el asistente para este estudio"
            }
            status={demiConfig?.mode === "demo" ? "Demo" : "Configurar"}
            tone={demiConfig?.mode === "demo" ? "active" : "available"}
            href="/admin/integraciones/demi"
          />

          <IntegrationCard
            mark="IG"
            name="Meta · Instagram + Facebook"
            description="Mensajes directos de Instagram y Messenger atendidos por Demi."
            detail="Un solo asistente, CRM e identidad por canal."
            status={metaInboxConnected ? "Conectado" : "Configurar"}
            tone={metaInboxConnected ? "active" : "available"}
            href="/admin/integraciones/meta-inbox"
          />
        </div>
      </section>

      <section className="integrations-v2-section">
        <div className="integrations-v2-section-heading">
          <div>
            <h2>Próximas integraciones</h2>
            <p>Servicios que podrán conectarse desde este mismo lugar cuando estén disponibles.</p>
          </div>
        </div>

        <div className="integrations-v2-grid">
          <IntegrationCard
            mark="S"
            name="Stripe"
            description="Cobros del estudio a alumnas mediante Stripe."
            detail="La facturación de Studio Flow es independiente de esta futura integración."
            status="Próximamente"
            tone="soon"
          />

        </div>
      </section>

      <section className="integrations-v2-note">
        Aquí solo viven servicios externos. Región, recursos, suscripción y otras configuraciones
        del estudio permanecen separadas.
      </section>
    </main>
  );
}
