"use client";

import { useState, useTransition } from "react";
import { provisionStudentAccess } from "./actions";

const errorCopy: Record<string, string> = {
  invalid_request: "No se pudo identificar a la alumna.",
  student_not_found: "No se encontró el expediente de la alumna.",
  student_lookup_failed: "No se pudo consultar el expediente de la alumna.",
  student_person_missing: "El expediente de la alumna no tiene una persona vinculada.",
  student_not_active: "Activa a la alumna antes de habilitar su acceso.",
  student_already_linked: "Esta alumna ya tiene una cuenta de acceso vinculada.",
  unauthenticated: "Tu sesión administrativa expiró. Vuelve a iniciar sesión e inténtalo de nuevo.",
  forbidden: "Tu cuenta no tiene permiso para habilitar accesos al portal.",
  authorization_failed: "No se pudo validar tu permiso administrativo.",
  auth_phone_exists:
    "Ese teléfono ya existe en Auth pero no está vinculado a este expediente. No se enlazó automáticamente por seguridad.",
  auth_create_failed: "Supabase Auth no pudo crear la cuenta.",
  link_failed: "La cuenta Auth se creó, pero el enlace operativo falló y fue revertido.",
  provision_unavailable: "El servicio seguro de aprovisionamiento no está disponible.",
};

export function StudentAccessProvisioner({
  studentId,
  phone,
}: {
  studentId: string;
  phone: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{
    phone: string;
    temporaryPassword: string;
  } | null>(null);

  function provision() {
    setError(null);
    startTransition(async () => {
      const result = await provisionStudentAccess(studentId);
      if (!result.ok) {
        setError(errorCopy[result.error] ?? "No se pudo habilitar el acceso de la alumna.");
        return;
      }

      setCredentials({ phone: result.phone, temporaryPassword: result.temporaryPassword });
    });
  }

  if (credentials) {
    return (
      <div className="student-list">
        <div className="notice success">
          Cuenta creada y vinculada. Esta contraseña temporal se muestra una sola vez y la alumna
          deberá reemplazarla al iniciar sesión.
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
        <p className="text-sm text-zinc-400">
          Entrégala por un canal privado. Studio Flow no la guarda y no puede volver a mostrarla.
        </p>
      </div>
    );
  }

  return (
    <div className="compact-form">
      <p>
        Se creará una cuenta Auth separada del expediente operativo y se vinculará con rol Student.
        El acceso usará <strong>{phone}</strong> y una contraseña temporal aleatoria.
      </p>
      {error ? <div className="notice error">{error}</div> : null}
      <button className="primary-button" type="button" onClick={provision} disabled={isPending}>
        {isPending ? "Habilitando acceso…" : "Habilitar acceso al portal"}
      </button>
    </div>
  );
}
