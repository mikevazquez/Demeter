"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import LoadingSpinner from "@/app/admin/components/LoadingSpinner";
import {
  provisionStudentAccess,
  regenerateStudentPassword,
  resendStudentActivationLink,
} from "./actions";

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
  activation_already_completed:
    "La alumna ya creó su contraseña. Si la olvidó, debe usar el flujo de recuperación de acceso.",
  auth_activation_reset_failed:
    "No se pudo preparar un nuevo enlace de activación. Inténtalo nuevamente.",
  auth_password_reset_failed: "No se pudo actualizar la contraseña. Inténtalo nuevamente.",
  account_update_failed: "La contraseña cambió, pero no se pudo actualizar el estado de la cuenta.",
  activation_link_failed:
    "La cuenta está lista, pero no se pudo generar el enlace de activación. Puedes reenviarlo.",
  activation_url_invalid: "No se pudo construir una liga segura de activación.",
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

type ActivationMode = "provision" | "resend";

function StudentActivationAction({
  studentId,
  phone,
  mode,
}: {
  studentId: string;
  phone: string;
  mode: ActivationMode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    phone: string;
    activationLinkGenerated: boolean;
    welcomeStatus: "accepted" | "skipped" | "error" | null;
  } | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const response =
        mode === "provision"
          ? await provisionStudentAccess(studentId)
          : await resendStudentActivationLink(studentId);

      if (!response.ok) {
        setError(errorCopy[response.error] ?? "No se pudo completar la operación.");
        return;
      }

      setResult({
        phone: response.phone,
        activationLinkGenerated: response.activationLinkGenerated,
        welcomeStatus: response.welcomeDelivery?.status ?? null,
      });
    });
  }

  function acknowledge() {
    setResult(null);
    router.refresh();
  }

  if (result) {
    const delivered = result.activationLinkGenerated && result.welcomeStatus === "accepted";

    return (
      <div className="student-list">
        <div className={delivered ? "notice success" : "notice error"}>
          {delivered
            ? mode === "provision"
              ? "Cuenta creada y vinculada. El enlace para crear su contraseña fue entregado a Asistian para enviarlo por WhatsApp."
              : "Nuevo enlace de activación entregado a Asistian para enviarlo por WhatsApp."
            : "La cuenta quedó preparada, pero el enlace de activación no pudo entregarse por WhatsApp. Puedes intentar reenviarlo."}
        </div>
        <div className="student-row">
          <div>
            <strong>Teléfono de acceso</strong>
            <span>{result.phone}</span>
          </div>
        </div>
        <p className="text-sm text-zinc-400">
          Studio Flow no muestra ni envía una contraseña inicial. La alumna elegirá su propia
          contraseña desde el enlace de activación.
        </p>
        <button className="secondary-button" type="button" onClick={acknowledge}>
          Listo
        </button>
      </div>
    );
  }

  return (
    <div className="compact-form">
      <p>
        {mode === "provision" ? (
          <>
            Se creará una cuenta de acceso para <strong>{phone}</strong>. La alumna recibirá por
            WhatsApp un enlace seguro para crear su propia contraseña.
          </>
        ) : (
          <>
            La cuenta sigue pendiente de activación. Puedes enviar un nuevo enlace a{" "}
            <strong>{phone}</strong>. El enlace anterior dejará de ser la vía de acceso prevista.
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
            <span>{mode === "provision" ? "Habilitando acceso…" : "Generando enlace…"}</span>
          </span>
        ) : mode === "provision" ? (
          "Habilitar acceso al portal"
        ) : (
          "Reenviar enlace de activación"
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
  return <StudentActivationAction studentId={studentId} phone={phone} mode="provision" />;
}

export function StudentActivationLinkResender({
  studentId,
  phone,
}: {
  studentId: string;
  phone: string;
}) {
  return <StudentActivationAction studentId={studentId} phone={phone} mode="resend" />;
}

export function StudentPasswordRegenerator({ studentId }: { studentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run() {
    if (
      !window.confirm(
        "Se reemplazará la contraseña actual de la alumna. La contraseña anterior dejará de funcionar. ¿Continuar?",
      )
    ) {
      return;
    }
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const response = await regenerateStudentPassword(studentId);
      if (!response.ok) {
        setError(errorCopy[response.error] ?? "No se pudo regenerar la contraseña.");
        return;
      }
      if (!response.temporaryPassword) {
        setError("La contraseña se actualizó, pero no fue posible mostrar la contraseña temporal.");
        return;
      }
      setTemporaryPassword(response.temporaryPassword);
    });
  }

  async function copyPassword() {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    setCopied(true);
  }

  if (temporaryPassword) {
    return (
      <div className="compact-form">
        <div className="notice success">
          Contraseña temporal generada. La contraseña anterior ya no funciona.
        </div>
        <div className="student-row">
          <div>
            <strong>Contraseña temporal</strong>
            <span style={{ fontFamily: "monospace", fontSize: "1rem" }}>{temporaryPassword}</span>
          </div>
        </div>
        <button className="secondary-button" type="button" onClick={copyPassword}>
          {copied ? "Copiada" : "Copiar contraseña"}
        </button>
        <p className="text-sm text-zinc-400">
          Esta contraseña sólo se muestra en este momento. Studio Flow no la guarda para volver a
          mostrarla.
        </p>
      </div>
    );
  }

  return (
    <div className="compact-form">
      <p>
        Genera una contraseña temporal nueva si la alumna olvidó la actual. La contraseña anterior
        dejará de funcionar inmediatamente.
      </p>
      {error ? <div className="notice error">{error}</div> : null}
      <button
        className="secondary-button"
        type="button"
        onClick={run}
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <LoadingSpinner />
            <span>Generando contraseña…</span>
          </span>
        ) : (
          "Regenerar contraseña"
        )}
      </button>
    </div>
  );
}
