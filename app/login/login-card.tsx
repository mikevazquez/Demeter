"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { signIn } from "@/app/auth/actions";

type LoginCardProps = {
  mode: "studio" | "student";
  error?: string;
};

const studioMessages: Record<string, string> = {
  missing: "Escribe tu correo y contraseña.",
  invalid: "El correo o la contraseña no son correctos.",
  rate: "Hay demasiados intentos de acceso. Espera un momento y vuelve a intentar.",
  auth: "No se pudo validar el acceso en este momento. Vuelve a intentarlo.",
  pending: "Tu cuenta existe, pero todavía no tiene acceso asignado al estudio.",
  access: "Esta cuenta no tiene acceso activo al estudio.",
  activation: "Tu acceso inicial necesita ser habilitado por el administrador del estudio.",
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

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.2 3.7 5.6 4.5c-1.1.6-1.7 1.8-1.4 3 1.3 5.5 5.7 9.9 11.2 11.2 1.2.3 2.4-.3 3-1.4l.8-1.6a1.5 1.5 0 0 0-.5-1.9l-3-2a1.5 1.5 0 0 0-1.9.2l-1 1.1a11.2 11.2 0 0 1-2-1.5 11.2 11.2 0 0 1-1.5-2l1.1-1a1.5 1.5 0 0 0 .2-1.9l-2-3a1.5 1.5 0 0 0-1.4-.7Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function DemeterBrand() {
  return (
    <div className="auth-brand" aria-label="Demeter">
      <strong>DEMETER</strong>
    </div>
  );
}

function AuthSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="primary-button auth-submit"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

function portalCopy(mode: LoginCardProps["mode"]) {
  if (mode === "student") {
    return {
      title: "Portal de alumna",
      copy: "Entra con tu número de teléfono y contraseña.",
    };
  }

  return {
    title: "Acceso al estudio",
    copy: "Entra con la cuenta que usas para trabajar en el estudio.",
  };
}

export function LoginCard({ mode, error }: LoginCardProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isStudent = mode === "student";
  const messages = isStudent ? studentMessages : studioMessages;
  const copy = portalCopy(mode);
  const passwordToggleLabel = passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña";

  return (
    <main className="auth-shell auth-login-shell">
      <section className="auth-card auth-login-card">
        <div className="auth-login-header">
          <Link className="auth-back-button" href="/" aria-label="Volver al inicio">
            ←
          </Link>
          <DemeterBrand />
        </div>

        <div className="auth-login-intro">
          <h1 className="auth-title">{copy.title}</h1>
          <p className="auth-copy">{copy.copy}</p>
        </div>

        {error && messages[error] ? <div className="notice error">{messages[error]}</div> : null}

        <form action={signIn} className="auth-form auth-login-form">
          <input type="hidden" name="mode" value={mode} />

          <label className="auth-field">
            <span className="auth-field-icon">{isStudent ? <PhoneIcon /> : <MailIcon />}</span>
            <span className="auth-field-body">
              <span className="auth-field-label">{isStudent ? "Teléfono" : "Correo"}</span>
              {isStudent ? (
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  placeholder="33 1234 5678"
                />
              ) : (
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="tu@demeter.com"
                />
              )}
            </span>
          </label>

          <label className="auth-field auth-password-field">
            <span className="auth-field-icon">
              <LockIcon />
            </span>
            <span className="auth-field-body">
              <span className="auth-field-label">Contraseña</span>
              <input
                name="password"
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="••••••••"
              />
            </span>
            <button
              type="button"
              className="auth-password-toggle"
              aria-label={passwordToggleLabel}
              aria-pressed={passwordVisible}
              title={passwordToggleLabel}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              <EyeIcon visible={passwordVisible} />
            </button>
          </label>

          <div className="auth-options">
            <span className="auth-remember">Sesión persistente en este dispositivo</span>
            <span className="auth-recovery-link">¿Olvidaste tu contraseña?</span>
          </div>

          <AuthSubmitButton />
        </form>

        <div className="auth-divider" aria-hidden="true">
          <span />
          <small>o</small>
          <span />
        </div>

        <Link className="auth-switch-button" href={isStudent ? "/login/studio" : "/login/student"}>
          {isStudent ? "Acceso al estudio" : "Soy alumna"}
        </Link>
      </section>
    </main>
  );
}
