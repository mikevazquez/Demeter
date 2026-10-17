import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import type { WorkshopSummary } from "@/src/lib/workshops/admin";

export default async function WorkshopsPage() {
  const ctx = await getAdminContext("schedule.read");
  const { data, error } = ctx.can("sales.read")
    ? await ctx.supabase.rpc("admin_workshop_context", { p_studio_id: ctx.studio.id })
    : { data: null, error: { message: "forbidden" } };
  const offers = (data?.offers ?? []) as WorkshopSummary[];
  const operationalOffers = offers.filter((offer) => !/^UAT(?:[\s_-]|$)/i.test(offer.title.trim()));
  const uatOffers = offers.filter((offer) => /^UAT(?:[\s_-]|$)/i.test(offer.title.trim()));
  const money = (value: number) =>
    new Intl.NumberFormat(ctx.studio.locale, {
      style: "currency",
      currency: ctx.studio.currency,
    }).format(value / 100);
  const renderOffer = (offer: WorkshopSummary) => (
    <Link className="activities-v2-card" key={offer.id} href={`/admin/actividades/talleres/${offer.id}`}>
      <span className="activities-v2-card-icon program-card-icon is-workshop" aria-hidden="true">▦</span>
      <span className="activities-v2-card-main">
        <span className="activities-v2-card-title"><strong>{offer.title}</strong><small>Taller</small></span>
        <span className="activities-v2-card-description">{offer.sessionCount} fechas · {money(offer.fullPriceMinor)} completo</span>
      </span>
      <span className="activities-v2-chevron" aria-hidden="true">›</span>
    </Link>
  );
  return (
    <main className="activities-v2 activities-page">
      <Link className="activities-v2-back" href="/admin/actividades">
        ← Actividades
      </Link>
      <header className="activities-v2-header">
        <div>
          <h1>Talleres configurables</h1>
          <p>Consulta fechas, precios y registra compras con anticipo o pago completo.</p>
        </div>
        {ctx.can("products.write") && ctx.can("schedule.write") ? (
          <Link href="/admin/actividades/talleres/nuevo">
            Nuevo taller
          </Link>
        ) : null}
      </header>
      {error ? (
        <p role="alert">
          No pudimos cargar los talleres de este estudio. Revisa tu acceso e intenta nuevamente.
        </p>
      ) : operationalOffers.length || uatOffers.length ? (
        <div className="activities-v2-list">
          {operationalOffers.map(renderOffer)}
          {operationalOffers.length === 0 ? <p>Aún no hay talleres operativos configurados.</p> : null}
          {uatOffers.length > 0 ? (
            <details className="activities-v2-inactive">
              <summary>Datos de prueba UAT ({uatOffers.length})</summary>
              <div className="activities-v2-list">{uatOffers.map(renderOffer)}</div>
            </details>
          ) : null}
        </div>
      ) : (
        <p>Aún no hay talleres configurados en este estudio.</p>
      )}
    </main>
  );
}
