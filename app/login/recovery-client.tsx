"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  type RecoveryRequestState,
  requestStudentRecoveryAction,
  requestStudioRecoveryAction,
} from "./recovery-actions";
import { ChatIcon, InfoIcon, MailIcon, PhoneIcon, RecoveryPath } from "./recovery-ui";
import { passwordRuleState, RECOVERY_RESEND_SECONDS } from "@/lib/auth/password-recovery-core";

const INITIAL_STATE: RecoveryRequestState = {
  status: "idle",
  destination: null,
  identifier: null,
  previewLink: null,
  sentAt: null,
};

export function SubmitButton({
  label,
  pendingLabel,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="srec-primary"
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function ResendButton({ sentAt }: { sentAt: number }) {
  const { pending } = useFormStatus();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, RECOVERY_RESEND_SECONDS - Math.floor((now - sentAt) / 1000));
  const label =
    remaining > 0 ? `Reenviar en 0:${String(remaining).padStart(2, "0")}` : "Reenviar enlace";

  return (
    <button className="srec-secondary" type="submit" disabled={pending || remaining > 0}>
      {pending ? "Enviando…" : label}
    </button>
  );
}

const PORTALS = {
  student: {
    action: requestStudentRecoveryAction,
    eyebrow: "Portal de alumnas",
    copy: "Escribe el teléfono con el que entras al portal. Te enviaremos por WhatsApp un enlace para crear una contraseña nueva.",
    label: "Teléfono",
    field: "phone",
    inputType: "tel",
    inputMode: "tel",
    autoComplete: "tel",
    placeholder: "33 1234 5678",
    note: "El enlace funciona en cualquier navegador y vence en 60 minutos. ¿Cambiaste de número? Avisa en recepción.",
    invalid: "Escribe un teléfono de 10 dígitos.",
    loginHref: "/login/student",
    sentTitle: "Revisa tu WhatsApp",
    sentCopy:
      "Si el teléfono está registrado, en un momento te llegará un mensaje de Demeter con el botón para crear tu contraseña.",
    otherLabel: "Usar otro teléfono",
  },
  studio: {
    action: requestStudioRecoveryAction,
    eyebrow: "Portal de administración",
    copy: "Escribe el correo de tu cuenta de equipo. Te enviaremos un enlace para crear una contraseña nueva.",
    label: "Correo",
    field: "email",
    inputType: "email",
    inputMode: "email",
    autoComplete: "email",
    placeholder: "tu@estudio.com",
    note: "Revisa también la carpeta de spam. El enlace vence en 60 minutos.",
    invalid: "Escribe un correo válido.",
    loginHref: "/login/studio",
    sentTitle: "Revisa tu correo",
    sentCopy:
      "Si el correo pertenece a una cuenta de equipo, en un momento te llegará un mensaje de Demeter con el botón para crear tu contraseña.",
    otherLabel: "Usar otro correo",
  },
} as const;

export function RecoveryRequestFlow({ portal }: { portal: keyof typeof PORTALS }) {
  const config = PORTALS[portal];
  const [state, formAction] = useActionState(config.action, INITIAL_STATE);
  const [editing, setEditing] = useState(false);
  const sent = state.status === "sent" && !editing;

  if (sent) {
    return (
      <>
        <RecoveryPath step={2} />
        <div className="srec-intro is-center" role="status">
          <span className="srec-badge">{portal === "student" ? <ChatIcon /> : <MailIcon />}</span>
          <h1 className="srec-title">{config.sentTitle}</h1>
          <p className="srec-copy">{config.sentCopy}</p>
        </div>

        {state.destination ? (
          <div className="srec-destinations">
            <div>
              {portal === "student" ? <PhoneIcon /> : <MailIcon size={18} />}
              <span>
                {portal === "student" ? "WhatsApp al teléfono terminado en " : "Correo a "}
                <strong>
                  {portal === "student" ? `•• ${state.destination}` : state.destination}
                </strong>
              </span>
            </div>
          </div>
        ) : null}

        {state.previewLink ? (
          <p className="srec-preview">
            Modo prueba (solo Sandbox): <a href={state.previewLink}>abrir enlace de recuperación</a>
          </p>
        ) : null}

        <p className="srec-small">
          El enlace vence en 60 minutos y solo se puede usar una vez. Puedes abrirlo desde cualquier
          navegador.
        </p>

        <div className="srec-footer">
          <form action={formAction}>
            <input type="hidden" name={config.field} value={state.identifier ?? ""} />
            <ResendButton key={state.sentAt ?? 0} sentAt={state.sentAt ?? Date.now()} />
          </form>
          <button className="srec-link" type="button" onClick={() => setEditing(true)}>
            {config.otherLabel}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <RecoveryPath step={1} />
      <div className="srec-intro">
        <span className="srec-eyebrow">{config.eyebrow}</span>
        <h1 className="srec-title">Recupera tu acceso</h1>
        <p className="srec-copy">{config.copy}</p>
      </div>

      {state.status === "invalid" ? (
        <div className="srec-error" role="alert">
          {config.invalid}
        </div>
      ) : null}
      {state.status === "unavailable" ? (
        <div className="srec-error" role="alert">
          No pudimos enviar el enlace en este momento. Intenta de nuevo en unos minutos.
        </div>
      ) : null}

      <form
        className="srec-form"
        action={(data) => {
          setEditing(false);
          formAction(data);
        }}
      >
        <label className="srec-field">
          <span className="srec-field-body">
            <span className="srec-field-label">{config.label}</span>
            <input
              name={config.field}
              type={config.inputType}
              inputMode={config.inputMode}
              autoComplete={config.autoComplete}
              placeholder={config.placeholder}
              defaultValue={editing ? "" : (state.identifier ?? "")}
              required
            />
          </span>
        </label>
        <div className="srec-note">
          <InfoIcon />
          <span>{config.note}</span>
        </div>
        <SubmitButton label="Enviar enlace" pendingLabel="Enviando…" />
      </form>

      <div className="srec-footer">
        <p className="srec-small">¿Ya la recordaste?</p>
        <Link className="srec-link" href={config.loginHref}>
          Volver a iniciar sesión
        </Link>
      </div>
    </>
  );
}

function RuleItem({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={met ? "is-met" : undefined}>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {met ? <path d="M5 12l5 5 9-10" /> : <circle cx="12" cy="12" r="8" />}
      </svg>
      {children}
      <span className="sr-only">{met ? " (cumplido)" : " (pendiente)"}</span>
    </li>
  );
}

export function NewPasswordFields() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const rules = passwordRuleState(password, confirmation);
  const ready = rules.length && rules.lettersAndNumbers && rules.matches;

  return (
    <>
      <label className="srec-field">
        <span className="srec-field-body">
          <span className="srec-field-label">Nueva contraseña</span>
          <input
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </span>
        <button
          className="srec-toggle"
          type="button"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
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
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </label>
      <label className="srec-field">
        <span className="srec-field-body">
          <span className="srec-field-label">Confirma la contraseña</span>
          <input
            name="password_confirmation"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </span>
      </label>
      <ul className="srec-rules" aria-live="polite">
        <RuleItem met={rules.length}>Al menos 8 caracteres</RuleItem>
        <RuleItem met={rules.lettersAndNumbers}>Incluye letras y números</RuleItem>
        <RuleItem met={rules.matches}>Las dos contraseñas coinciden</RuleItem>
      </ul>
      <SubmitButton label="Guardar y entrar" pendingLabel="Guardando…" disabled={!ready} />
    </>
  );
}
