import Link from "next/link";
import { signIn } from "@/app/auth/actions";

type LoginCardProps = {
  mode: "admin" | "student";
  error?: string;
};

const adminMessages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso a administración.",
};

const studentMessages: Record<string, string> = {
  missing: "Escribe tu teléfono y contraseña.",
  invalid: "El teléfono o la contraseña no son correctos.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso al portal de alumna.",
};

export function LoginCard({ mode, error }: LoginCardProps) {
  const isAdmin = mode === "admin";
  const messages = isAdmin ? adminMessages : studentMessages;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="back-link" href="/">
          ← Inicio
        </Link>
        <p className="eyebrow">DEMETER · STUDIO FLOW</p>
        <h1 className="auth-title">{isAdmin ? "Administración" : "Portal de alumna"}</h1>
        <p className="auth-copy">
          {isAdmin
            ? "Accede para gestionar la operación del estudio."
            : "Accede con el teléfono registrado en el estudio y tu contraseña."}
        </p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={signIn} className="auth-form">
          <input type="hidden" name="mode" value={mode} />
          {isAdmin ? (
            <label>
              Correo
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="tu@correo.com"
              />
            </label>
          ) : (
            <label>
              Teléfono
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                placeholder="33 1234 5678"
              />
            </label>
          )}
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </label>
          <button className="primary-button" type="submit">
            Entrar
          </button>
        </form>

        <p className="switch-copy">
          {isAdmin ? "¿Eres alumna?" : "¿Eres parte del equipo?"}{" "}
          <Link href={isAdmin ? "/login/student" : "/login/admin"}>
            {isAdmin ? "Ir al portal de alumna" : "Ir a administración"}
          </Link>
        </p>
      </section>
    </main>
  );
}
