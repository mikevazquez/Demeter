import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="landing-card">
        <div>
          <p className="eyebrow">DEMETER · STUDIO FLOW</p>
          <h1>Tu estudio, en un solo lugar.</h1>
          <p className="landing-copy">
            Operación del estudio y experiencia de alumnas, cada una en su contexto.
          </p>
        </div>

        <div className="portal-grid">
          <Link className="portal-card" href="/login/studio">
            <span className="portal-kicker">MI ESTUDIO</span>
            <strong>Acceso al estudio</strong>
            <p>Owner, administración, recepción y coaches entran desde aquí.</p>
            <span className="portal-arrow">→</span>
          </Link>
          <Link className="portal-card" href="/login/student">
            <span className="portal-kicker">SOY ALUMNA</span>
            <strong>Mi cuenta</strong>
            <p>Reserva clases, revisa tu paquete y consulta tu progreso.</p>
            <span className="portal-arrow">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
