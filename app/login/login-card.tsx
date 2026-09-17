"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "@/app/auth/actions";

type LoginCardProps = {
  mode: "admin" | "coach" | "student";
  error?: string;
};

const adminMessages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  rate: "Hay demasiados intentos de acceso. Espera un momento y vuelve a intentar.",
  auth: "No se pudo validar el acceso en este momento. Vuelve a intentarlo.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso a administración.",
};

const coachMessages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  rate: "Hay demasiados intentos de acceso. Espera un momento y vuelve a intentar.",
  auth: "No se pudo validar el acceso en este momento. Vuelve a intentarlo.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso al portal Coach.",
};

const studentMessages: Record<string, string> = {
  missing: "Escribe tu teléfono y contraseña.",
  invalid: "El teléfono o la contraseña no son correctos.",
  rate: "Hay demasiados intentos de acceso. Espera un momento y vuelve a intentar.",
  auth: "No se pudo validar el acceso en este momento. Vuelve a intentarlo.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso al portal de alumna.",
};

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3l18 18" />
        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
        <path d="M9.9 4.3A10.8 10.8 0 0 1 12 4c5.5 0 9.5 4.6 10 6.8a4.8 4.8 0 0 1-.8 1.7" />
        <path d="M6.6 6.7C4 8.3 2.4 10.3 2 11.8 2.7 14.5 6.5 18 12 18c1 0 2-.1 2.9-.4" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isStudent = mode === "student";
  const messages =
    mode === "student" ? studentMessages : mode === "coach" ? coachMessages : adminMessages;
  const copy = portalCopy(mode);
  const passwordToggleLabel = passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña";

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
            <div style={{ position: "relative" }}>
              <input
                name="password"
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="••••••••"
                style={{ paddingRight: 54 }}
              />
              <button
                type="button"
                aria-label={passwordToggleLabel}
                aria-pressed={passwordVisible}
                title={passwordToggleLabel}
                onClick={() => setPasswordVisible((visible) => !visible)}
                style={{
                  position: "absolute",
                  top: "50%",
                  right: 10,
                  transform: "translateY(-50%)",
                  width: 36,
                  height: 36,
                  display: "grid",
                  placeItems: "center",
                  padding: 0,
                  border: 0,
                  borderRadius: 10,
                  background: "transparent",
                  color: "var(--muted)",
                }}
              >
                <EyeIcon visible={passwordVisible} />
              </button>
            </div>
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
