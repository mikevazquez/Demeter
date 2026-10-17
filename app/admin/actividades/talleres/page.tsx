import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import type { WorkshopSummary } from "@/src/lib/workshops/admin";

export default async function WorkshopsPage() {
  const ctx = await getAdminContext("schedule.read");
  const { data, error } = ctx.can("sales.read")
    ? await ctx.supabase.rpc("admin_workshop_context", { p_studio_id: ctx.studio.id })
    : { data: null, error: { message: "forbidden" } };
  const offers = (data?.offers ?? []) as WorkshopSummary[];
  const operationalOffers = offers.filter((offer) => !/^UAT(?:[\\s_-]|$)/i.test(offer.title.trim()));
  const uatOffers = offers.filter((offer) => /^UAT(?:[\\s_-]|$)/i.test(offer.title.trim()));
  const money = (minor: number) =>
    new Intl.NumberFormat(ctx.studio.locale, {
      style: "currency",
      currency: ctx.studio.currency,
    }).format(minor / 100);
  const offerCard = (offer: WorkshopSummary) => (
    <Link
      key={offer.id}
      href={`/admin/actividades/talleres/${offer.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minWidth: 0,
        padding: 18,
        border: "1px solid var(--border, #d9e2df)",
        borderRadius: 16,
        textDecoration: "none",
        color: "inherit",
        background: "var(--surface, #fff)",
      }}
    >
      <span style={{ minWidth: 0, flex: 1, display: "grid", gap: 6 }}>
        <strong style={{ overflowWrap: "anywhere", lineHeight: 1.35 }}>{offer.title}</strong>
        <span style={{ fontSize: 14, opacity: 0.75 }}>
          {offer.sessionCount} fechas · {money(offer.fullPriceMinor)} completo
        </span>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );

  return (
    <main className="activities-v2 activities-page">
      <Link className="activities-v2-back" href="/admin/actividades">← Actividades</Link>
      <header style={{ marginBlock: 24 }}>
        <h1>Configuración de actividades especiales</h1>
        <p>Define fechas, precios, cupos y condiciones. Las reservas y pagos se reflejan en los módulos existentes.</p>
      </header>
      <nav aria-label="Tipo de actividad especial" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 24 }}>
        <span aria-current="page" style={{ padding: "12px 4px", textAlign: "center", borderRadius: 12, border: "2px solid #159e78", fontWeight: 700 }}>Talleres</span>
        <Link href="/admin/actividades/programas/nuevo?kind=event" style={{ padding: "12px 4px", textAlign: "center", borderRadius: 12, border: "1px solid #aaa", color: "inherit" }}>Eventos</Link>
        <span aria-disabled="true" title="Pendiente de implementación y UAT" style={{ padding: "12px 4px", textAlign: "center", borderRadius: 12, border: "1px solid #aaa", opacity: 0.55 }}>Master class</span>
      </nav>
      <section aria-labelledby="workshops-heading">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <h2 id="workshops-heading" style={{ margin: 0 }}>Talleres</h2>
          {ctx.can("products.write") && ctx.can("schedule.write") ? (
            <Link href="/admin/actividades/talleres/nuevo" style={{ display: "inline-block", padding: "10px 16px", borderRadius: 12, border: "1px solid currentColor", color: "inherit", fontWeight: 600 }}>+ Crear taller</Link>
          ) : null}
        </div>
        {error ? (
          <p role="alert">No pudimos cargar los talleres. Revisa los permisos del estudio.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {operationalOffers.map(offerCard)}
            {operationalOffers.length === 0 ? <p>Aún no hay talleres operativos.</p> : null}
            {uatOffers.length > 0 ? (
              <details style={{ marginTop: 20 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Registros de prueba UAT ({uatOffers.length})</summary>
                <div style={{ display: "grid", gap: 12, marginTop: 12 }}>{uatOffers.map(offerCard)}</div>
              </details>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
