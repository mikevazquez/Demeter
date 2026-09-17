import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="landing-card">
        <div>
          <p className="eyebrow">DEMETER · STUDIO FLOW</p>
          <h1>Tu estudio, en un solo lugar.</h1>
          <p className="landing-copy">
            Administración, clases, paquetes y experiencia de alumnas sobre una sola plataforma.
          </p>
        </div>

        <div className="portal-grid">
          <Link className="portal-card" href="/login/admin">
            <span className="portal-kicker">EQUIPO</span>
            <strong>Administración</strong>
            <p>Gestiona la operación diaria del estudio.</p>
            <span className="portal-arrow">→</span>
          </Link>
          <Link className="portal-card" href="/login/coach">
            <span className="portal-kicker">COACH</span>
            <strong>Mis clases</strong>
            <p>Consulta tus clases asignadas y gestiona asistencia.</p>
            <span className="portal-arrow">→</span>
          </Link>
          <Link className="portal-card" href="/login/student">
            <span className="portal-kicker">ALUMNAS</span>
            <strong>Mi cuenta</strong>
            <p>Consulta tu paquete y próximas clases.</p>
            <span className="portal-arrow">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
