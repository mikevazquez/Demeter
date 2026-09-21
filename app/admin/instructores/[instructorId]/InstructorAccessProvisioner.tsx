"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { provisionInstructorAccess, resetInstructorTemporaryPassword } from "./access-actions";

const errorCopy: Record<string, string> = {
  invalid_request: "No se pudo identificar al instructor.",
  instructor_not_found: "No se encontró el perfil del instructor.",
  instructor_lookup_failed: "No se pudo consultar el perfil del instructor.",
  instructor_not_active: "Activa al instructor antes de habilitar su acceso.",
  instructor_identity_lookup_failed: "No se pudo consultar la identidad del instructor.",
  instructor_email_required: "Agrega un correo válido al instructor antes de habilitar su acceso.",
  instructor_already_linked: "Este instructor ya tiene una cuenta de acceso vinculada.",
  instructor_access_missing: "El instructor todavía no tiene una cuenta de acceso vinculada.",
  instructor_access_inconsistent: "La cuenta de acceso está incompleta o inconsistente.",
  access_lookup_failed: "No se pudo consultar el estado de la cuenta de acceso.",
  temporary_password_reset_closed:
    "El instructor ya completó su activación. Ya no se puede regenerar la contraseña temporal.",
  auth_password_reset_failed: "Supabase Auth no pudo generar una nueva contraseña temporal.",
  access_reset_state_failed:
    "No se pudo preparar la cuenta para el cambio obligatorio de contraseña.",
  unauthenticated: "Tu sesión administrativa expiró. Vuelve a iniciar sesión.",
  forbidden: "Tu cuenta no tiene permiso para habilitar accesos.",
  authorization_failed: "No se pudo validar tu permiso administrativo.",
  auth_login_exists:
    "Ese correo ya existe en Auth pero no está vinculado a este instructor. No se enlazó automáticamente por seguridad.",
  auth_create_failed: "Supabase Auth no pudo crear la cuenta.",
  link_failed: "La cuenta Auth se creó, pero el enlace operativo falló y fue revertido.",
  provision_unavailable: "El servicio seguro de aprovisionamiento no está disponible.",
};

type CredentialMode = "provision" | "reset";

export function InstructorAccessProvisioner({
  instructorId,
  email,
  mode,
}: {
  instructorId: string;
  email: string;
  mode: CredentialMode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    temporaryPassword: string;
  } | null>(null);

  function run() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result =
        mode === "provision"
          ? await provisionInstructorAccess(instructorId)
          : await resetInstructorTemporaryPassword(instructorId);

      if (!result.ok) {
        setError(errorCopy[result.error] ?? "No se pudo completar la operación.");
        return;
      }

      setCredentials({
        email: result.email,
        temporaryPassword: result.temporaryPassword,
      });
    });
  }

  async function copyPassword() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(credentials.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function acknowledgeCredentials() {
    setCredentials(null);
    router.refresh();
  }

  if (credentials) {
    return (
      <div className="student-list">
        <div className="notice success">
          {mode === "provision"
            ? "Cuenta Coach creada y vinculada. Guarda la contraseña temporal antes de cerrar este panel."
            : "Nueva contraseña temporal generada. La anterior ya no funciona y el instructor deberá reemplazar esta al iniciar sesión."}
        </div>
        <div className="student-row">
          <div>
            <strong>Correo de acceso</strong>
            <span>{credentials.email}</span>
          </div>
        </div>
        <div className="student-row">
          <div>
            <strong>Contraseña temporal</strong>
            <span className="font-mono break-all">{credentials.temporaryPassword}</span>
          </div>
        </div>
        <div className="compact-form">
          <button className="primary-button" type="button" onClick={copyPassword}>
            {copied ? "Contraseña copiada" : "Copiar contraseña"}
          </button>
          <button className="secondary-button" type="button" onClick={acknowledgeCredentials}>
            Ya la guardé
          </button>
        </div>
        <p className="text-sm text-zinc-400">
          Entrégala por un canal privado. El Coach deberá cambiarla en su primer acceso y Studio
          Flow no volverá a mostrar esta misma contraseña.
        </p>
      </div>
    );
  }

  return (
    <div className="compact-form">
      <p>
        {mode === "provision" ? (
          <>
            Se creará una cuenta Auth separada del perfil operativo, vinculada con rol Instructor.
            El acceso usará <strong>{email || "el correo registrado"}</strong>.
          </>
        ) : (
          <>
            La cuenta ya existe. Puedes generar una nueva contraseña temporal para{" "}
            <strong>{email}</strong>; la anterior dejará de funcionar y el instructor deberá
            reemplazarla al iniciar sesión.
          </>
        )}
      </p>
      {error ? <div className="notice error">{error}</div> : null}
      <button className="primary-button" type="button" onClick={run} disabled={isPending}>
        {isPending
          ? mode === "provision"
            ? "Habilitando acceso…"
            : "Generando contraseña…"
          : mode === "provision"
            ? "Habilitar acceso Coach"
            : "Generar nueva contraseña temporal"}
      </button>
    </div>
  );
}
