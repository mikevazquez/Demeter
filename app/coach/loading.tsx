export default function CoachLoading() {
  return (
    <main className="sf-admin-loading" aria-live="polite" aria-busy="true">
      <header className="sf-admin-loading-header">
        <span className="sf-skeleton sf-skeleton-kicker" />
        <span className="sf-skeleton sf-skeleton-title" />
      </header>
      <section className="sf-admin-loading-toolbar">
        <span className="sf-skeleton sf-skeleton-control" />
        <span className="sf-skeleton sf-skeleton-control is-short" />
      </section>
      <section className="sf-admin-loading-grid" aria-label="Cargando clases">
        <span className="sf-skeleton sf-skeleton-card" />
        <span className="sf-skeleton sf-skeleton-card" />
        <span className="sf-skeleton sf-skeleton-card" />
      </section>
      <section className="sf-admin-loading-list">
        <span className="sf-skeleton sf-skeleton-row" />
        <span className="sf-skeleton sf-skeleton-row" />
      </section>
      <span className="sr-only">Cargando tus clases…</span>
    </main>
  );
}
