import Link from "next/link";
import { signIn } from "@/app/auth/actions";

type LoginCardProps = {
  mode: "admin" | "student";
  error?: string;
};

const messages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso a este portal.",
};

export function LoginCard({ mode, error }: LoginCardProps) {
  const isAdmin = mode === "admin";

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
            ? "Accede para gestionar clases, alumnas, paquetes y la operación del estudio."
            : "Consulta tu paquete, próximas clases y actividad en el estudio."}
        </p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={signIn} className="auth-form">
          <input type="hidden" name="mode" value={mode} />
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
