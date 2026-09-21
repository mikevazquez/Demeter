"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import LoadingSpinner from "@/app/admin/components/LoadingSpinner";
import { provisionStudentAccess, resetStudentTemporaryPassword } from "./actions";

const errorCopy: Record<string, string> = {
  invalid_request: "No se pudo identificar a la alumna.",
  student_not_found: "No se encontró el expediente de la alumna.",
  student_lookup_failed: "No se pudo consultar el expediente de la alumna.",
  student_person_missing: "El expediente de la alumna no tiene una persona vinculada.",
  student_phone_invalid: "El teléfono registrado no tiene un formato válido para iniciar sesión.",
  student_not_active: "Activa a la alumna antes de habilitar su acceso.",
  student_already_linked: "Esta alumna ya tiene una cuenta de acceso vinculada.",
  student_access_missing: "La alumna todavía no tiene una cuenta de acceso vinculada.",
  student_access_inconsistent: "La cuenta de acceso está incompleta o inconsistente.",
  access_lookup_failed: "No se pudo consultar el estado de la cuenta de acceso.",
  temporary_password_reset_closed:
    "La alumna ya completó su activación. Ya no se puede regenerar la contraseña temporal.",
  auth_password_reset_failed: "Supabase Auth no pudo generar una nueva contraseña temporal.",
  unauthenticated: "Tu sesión administrativa expiró. Vuelve a iniciar sesión e inténtalo de nuevo.",
  forbidden: "Tu cuenta no tiene permiso para habilitar accesos al portal.",
  authorization_failed: "No se pudo validar tu permiso administrativo.",
  auth_login_exists:
    "Ese acceso ya existe en Auth pero no está vinculado a este expediente. No se enlazó automáticamente por seguridad.",
  auth_phone_exists:
    "Ese teléfono ya existe en Auth pero no está vinculado a este expediente. No se enlazó automáticamente por seguridad.",
  auth_create_failed: "Supabase Auth no pudo crear la cuenta.",
  link_failed: "La cuenta Auth se creó, pero el enlace operativo falló y fue revertido.",
  provision_unavailable: "El servicio seguro de aprovisionamiento no está disponible.",
};

type CredentialMode = "provision" | "reset";

function StudentCredentialAction({
  studentId,
  phone,
  mode,
}: {
  studentId: string;
  phone: string;
  mode: CredentialMode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState<{
    phone: string;
    temporaryPassword: string;
    welcomeStatus: "accepted" | "skipped" | "error" | null;
  } | null>(null);

  function run() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result =
        mode === "provision"
          ? await provisionStudentAccess(studentId)
          : await resetStudentTemporaryPassword(studentId);

      if (!result.ok) {
        setError(errorCopy[result.error] ?? "No se pudo completar la operación.");
        return;
      }

      setCredentials({
        phone: result.phone,
        temporaryPassword: result.temporaryPassword,
        welcomeStatus: result.welcomeDelivery?.status ?? null,
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
            ? credentials.welcomeStatus === "accepted"
              ? "Cuenta creada y vinculada. La bienvenida fue entregada a Asistian para su envío por WhatsApp."
              : "Cuenta creada y vinculada. La bienvenida no pudo entregarse a Asistian; conserva la contraseña para compartirla manualmente."
            : "Nueva contraseña temporal generada. La anterior ya no funciona y esta permanecerá visible hasta que pulses ‘Ya la guardé’."}
        </div>
        <div className="student-row">
          <div>
            <strong>Teléfono de acceso</strong>
            <span>{credentials.phone}</span>
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
          Entrégala por un canal privado. Studio Flow no guarda esta contraseña y no puede volver a
          mostrar la misma después de cerrar este panel.
        </p>
      </div>
    );
  }

  return (
    <div className="compact-form">
      <p>
        {mode === "provision" ? (
          <>
            Se creará una cuenta Auth separada del expediente operativo y se vinculará con rol
            Student. El acceso usará <strong>{phone}</strong> y una contraseña temporal aleatoria.
          </>
        ) : (
          <>
            La cuenta ya existe y sigue pendiente de activación. Puedes generar una nueva contraseña
            temporal para <strong>{phone}</strong>; la anterior dejará de funcionar.
          </>
        )}
      </p>
      {error ? <div className="notice error">{error}</div> : null}
      <button
        className="primary-button"
        type="button"
        onClick={run}
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <LoadingSpinner />
            <span>{mode === "provision" ? "Habilitando acceso…" : "Generando contraseña…"}</span>
          </span>
        ) : mode === "provision" ? (
          "Habilitar acceso al portal"
        ) : (
          "Generar nueva contraseña temporal"
        )}
      </button>
    </div>
  );
}

export function StudentAccessProvisioner({
  studentId,
  phone,
}: {
  studentId: string;
  phone: string;
}) {
  return <StudentCredentialAction studentId={studentId} phone={phone} mode="provision" />;
}

export function StudentTemporaryPasswordResetter({
  studentId,
  phone,
}: {
  studentId: string;
  phone: string;
}) {
  return <StudentCredentialAction studentId={studentId} phone={phone} mode="reset" />;
}
