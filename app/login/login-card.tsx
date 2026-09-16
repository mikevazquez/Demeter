import Link from "next/link";
import { signIn } from "@/app/auth/actions";

type LoginCardProps = {
  mode: "admin" | "coach" | "student";
  error?: string;
};

const adminMessages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso a administración.",
};

const coachMessages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso al portal Coach.",
};

const studentMessages: Record<string, string> = {
  missing: "Escribe tu teléfono y contraseña.",
  invalid: "El teléfono o la contraseña no son correctos.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso al portal de alumna.",
};

function portalCopy(mode: LoginCardProps["mode"]) {
  if (mode === "student") {
    return {
      title: "Portal de alumna",
      copy: "Accede con el teléfono registrado en el estudio y tu contraseña.",
    };
  }
  if (mode === "coach") {
    return {
      title: "Coach",
      copy: "Accede para consultar tus clases asignadas y gestionar asistencia.",
    };
  }
  return {
    title: "Administración",
    copy: "Accede para gestionar la operación del estudio.",
  };
}

function SwitchLinks({ mode }: { mode: LoginCardProps["mode"] }) {
  if (mode === "admin") {
    return (
      <>
        ¿Otro portal? <Link href="/login/coach">Coach</Link> ·{" "}
        <Link href="/login/student">Alumna</Link>
      </>
    );
  }

  if (mode === "coach") {
    return (
      <>
        ¿Otro portal? <Link href="/login/admin">Administración</Link> ·{" "}
        <Link href="/login/student">Alumna</Link>
      </>
    );
  }

  return (
    <>
      ¿Eres parte del equipo? <Link href="/login/admin">Administración</Link> ·{" "}
      <Link href="/login/coach">Coach</Link>
    </>
  );
}

export function LoginCard({ mode, error }: LoginCardProps) {
  const isStudent = mode === "student";
  const messages =
    mode === "student" ? studentMessages : mode === "coach" ? coachMessages : adminMessages;
  const copy = portalCopy(mode);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="back-link" href="/">
          ← Inicio
        </Link>
        <p className="eyebrow">DEMETER · STUDIO FLOW</p>
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-copy">{copy.copy}</p>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={signIn} className="auth-form">
          <input type="hidden" name="mode" value={mode} />
          {isStudent ? (
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
          ) : (
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
          <SwitchLinks mode={mode} />
        </p>
      </section>
    </main>
  );
}
