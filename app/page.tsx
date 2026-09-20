import Link from "next/link";

import { StudioPortalLanding } from "@/app/components/studio-portal-landing";
import { getPublicStudioPortal } from "@/lib/studio-public-portal";

export default async function HomePage() {
  const portal = await getPublicStudioPortal();

  if (portal) {
    return <StudioPortalLanding portal={portal} />;
  }

  return (
    <main className="landing-shell">
      <section className="landing-card">
        <div>
          <p className="eyebrow">DEMETER</p>
          <h1>Tu estudio, en un solo lugar.</h1>
          <p className="landing-copy">
            Accede desde el enlace de tu estudio o inicia sesión en el portal correspondiente.
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
