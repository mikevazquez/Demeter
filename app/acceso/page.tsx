import Link from "next/link";

import { resolveStudentAccess } from "./actions";

const messages: Record<string, { title: string; copy: string; tone?: "error" | "success" }> = {
  invalid: {
    title: "Revisa tu número",
    copy: "Escribe un número de teléfono válido para continuar.",
    tone: "error",
  },
  not_found: {
    title: "No encontramos tu cuenta",
    copy: "No hay una alumna registrada con ese número. Si acabas de reservar, revisa que hayas usado el mismo teléfono.",
    tone: "error",
  },
  pending: {
    title: "Tu registro ya existe",
    copy: "Tu cuenta está registrada en Demeter, pero el acceso inicial todavía no está activado. Por ahora solicita al estudio que active tu acceso.",
    tone: "success",
  },
  error: {
    title: "No pudimos revisar tu acceso",
    copy: "Intenta de nuevo en un momento. Si continúa el problema, comunícate con el estudio.",
    tone: "error",
  },
};

export default async function StudentAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const message = state ? messages[state] : null;

  return (
    <main className="auth-shell auth-login-shell">
      <section className="auth-card auth-login-card">
        <div className="auth-login-header">
          <Link className="auth-back-button" href="/" aria-label="Volver al inicio">
            ←
          </Link>
          <div className="auth-brand" aria-label="Demeter">
            <strong>DEMETER</strong>
          </div>
        </div>

        <div className="auth-login-intro">
          <h1 className="auth-title">Acceso de alumna</h1>
          <p className="auth-copy">
            Escribe el teléfono con el que reservaste. Revisaremos si tu acceso ya está listo.
          </p>
        </div>

        {message ? (
          <div className={`notice ${message.tone === "success" ? "success" : "error"}`}>
            <strong>{message.title}</strong>
            <div>{message.copy}</div>
          </div>
        ) : null}

        {state !== "pending" ? (
          <form action={resolveStudentAccess} className="auth-form auth-login-form">
            <label className="auth-field">
              <span className="auth-field-body">
                <span className="auth-field-label">Teléfono</span>
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  placeholder="33 1234 5678"
                />
              </span>
            </label>

            <button className="primary-button auth-submit" type="submit">
              Continuar
            </button>
          </form>
        ) : (
          <Link className="auth-switch-button" href="/acceso">
            Usar otro número
          </Link>
        )}

        <div className="auth-divider" aria-hidden="true">
          <span />
          <small>o</small>
          <span />
        </div>

        <Link className="auth-switch-button" href="/login/student">
          Ya tengo contraseña
        </Link>
      </section>
    </main>
  );
}
