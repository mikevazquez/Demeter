export default function AdminLoading() {
  return (
    <main className="admin-route-state" aria-live="polite" aria-busy="true">
      <section className="admin-state-card admin-state-loading">
        <div className="admin-state-spinner" aria-hidden="true" />
        <p className="admin-state-eyebrow">STUDIO FLOW</p>
        <h1>Cargando tu estudio…</h1>
        <p>Estamos preparando la información más reciente.</p>
      </section>
    </main>
  );
}
