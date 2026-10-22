import Link from "next/link";
import type { ReactNode } from "react";

import "./sendero-recovery.css";

export type RecoveryStep = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Identifícate", "Recibe tu enlace", "Nueva contraseña"] as const;

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function RecoveryPath({ step }: { step: RecoveryStep }) {
  return (
    <ol className="srec-path" aria-label={`Paso ${Math.min(step, 3)} de 3`}>
      {STEP_LABELS.flatMap((label, index) => {
        const number = index + 1;
        const done = step > number;
        const current = step === number;
        const item = (
          <li key={label} aria-current={current ? "step" : undefined}>
            <span className={`srec-dot${done ? " is-done" : current ? " is-current" : ""}`}>
              {done ? <CheckIcon /> : number}
            </span>
            {label}
          </li>
        );
        if (index === 0) return [item];
        return [
          <li
            key={`line-${number}`}
            className={`srec-path-line${step >= number ? " is-done" : ""}`}
            aria-hidden="true"
          />,
          item,
        ];
      })}
    </ol>
  );
}

export function RecoveryShell({
  backHref,
  children,
}: {
  backHref?: string;
  children: ReactNode;
}) {
  return (
    <main className="srec-shell">
      <section className="srec-card">
        <div className="srec-header">
          {backHref ? (
            <Link className="srec-icon-link" href={backHref} aria-label="Volver">
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
          ) : (
            <span />
          )}
          <strong aria-label="Demeter">DEMETER</strong>
          <span />
        </div>
        {children}
      </section>
    </main>
  );
}

export function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z" />
      <path d="M9 11.5h.01M12.5 11.5h.01M16 11.5h.01" />
    </svg>
  );
}

export function MailIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function LockDoneIcon() {
  return (
    <svg
      aria-hidden="true"
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
      <path d="M10 16l1.5 1.5L14.5 14" />
    </svg>
  );
}

export function ExpiredLink({ retryHref, loginHref }: { retryHref: string; loginHref: string }) {
  return (
    <>
      <RecoveryPath step={2} />
      <div className="srec-intro is-center">
        <span className="srec-badge is-warning">
          <svg
            aria-hidden="true"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2" />
            <path d="M9 2h6" />
          </svg>
        </span>
        <h1 className="srec-title">Este enlace ya no funciona</h1>
        <p className="srec-copy">
          Venció o ya se usó. Por seguridad cada enlace sirve una sola vez durante 60 minutos. Pide
          uno nuevo y llegará en segundos.
        </p>
      </div>
      <div className="srec-footer">
        <Link className="srec-primary" href={retryHref}>
          Pedir un enlace nuevo
        </Link>
        <Link className="srec-link" href={loginHref}>
          Volver a iniciar sesión
        </Link>
      </div>
    </>
  );
}
