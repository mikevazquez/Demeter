import type { CSSProperties } from "react";
import Link from "next/link";

import type { PublicStudioPortal } from "@/lib/studio-public-portal";

function BuildingIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 21V5l8-2v18" />
      <path d="M12 8h8v13" />
      <path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M2 21h20" />
    </svg>
  );
}

function StudentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c.6-4 3-6 7-6s6.4 2 7 6" />
    </svg>
  );
}

export function StudioPortalLanding({ portal }: { portal: PublicStudioPortal }) {
  const accentStyle = {
    "--studio-accent": portal.primaryColor,
  } as CSSProperties;

  return (
    <main className="studio-entry-shell" style={accentStyle}>
      <section className="studio-entry-card">
        <div className="studio-entry-brand">
          {portal.logoUrl ? (
            <div
              className="studio-entry-logo"
              role="img"
              aria-label={`Logo de ${portal.name}`}
              style={{ backgroundImage: `url("${portal.logoUrl}")` }}
            />
          ) : (
            <div className="studio-entry-logo-fallback" aria-hidden="true">
              {portal.name.slice(0, 1).toUpperCase()}
            </div>
          )}

          <h1>{portal.name}</h1>
          <span className="studio-entry-rule" aria-hidden="true" />
          {portal.tagline ? <p>{portal.tagline}</p> : null}
        </div>

        <div className="studio-entry-actions">
          <Link className="studio-entry-option" href={`/login/studio?studio=${portal.slug}`}>
            <span className="studio-entry-option-icon">
              <BuildingIcon />
            </span>
            <span className="studio-entry-option-copy">
              <strong>MI ESTUDIO</strong>
              <small>Administra tu estudio, clases y alumnas.</small>
            </span>
            <span className="studio-entry-arrow" aria-hidden="true">
              →
            </span>
          </Link>

          <Link className="studio-entry-option" href={`/login/student?studio=${portal.slug}`}>
            <span className="studio-entry-option-icon">
              <StudentIcon />
            </span>
            <span className="studio-entry-option-copy">
              <strong>SOY ALUMNA</strong>
              <small>Reserva clases, revisa tu paquete y progreso.</small>
            </span>
            <span className="studio-entry-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>

        <p className="studio-entry-footer">DISCIPLINA · COMUNIDAD · TRANSFORMACIÓN</p>
      </section>
    </main>
  );
}
