export default function IntelligenceLoading() {
  return (
    <main className="intel-page" aria-busy="true" aria-label="Cargando inteligencia">
      <p className="intel-kicker">INTELIGENCIA</p>
      <h1>Cargando métricas…</h1>
      <p role="status">Consultando los datos del estudio.</p>
      <div className="intel-kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="intel-metric" key={i} aria-hidden="true">
            <span>Periodo seleccionado</span>
            <strong>—</strong>
          </div>
        ))}
      </div>
    </main>
  );
}
