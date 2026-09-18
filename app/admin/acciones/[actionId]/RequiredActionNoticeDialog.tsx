"use client";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

const successCopy: Record<string, { eyebrow: string; title: string; body: string }> = {
  assigned: {
    eyebrow: "RESPONSABLE ACTUALIZADO",
    title: "La acción quedó asignada",
    body: "El nuevo responsable quedó registrado en la acción y en su timeline.",
  },
  taken: {
    eyebrow: "ACCIÓN TOMADA",
    title: "La acción está en proceso",
    body: "Quedaste como responsable y el cambio quedó registrado en el timeline.",
  },
  resolved: {
    eyebrow: "ACCIÓN RESUELTA",
    title: "La incidencia quedó resuelta",
    body: "La resolución quedó registrada y la acción dejó de estar abierta.",
  },
  discarded: {
    eyebrow: "ACCIÓN DESCARTADA",
    title: "La acción fue descartada",
    body: "El motivo de descarte quedó guardado en la trazabilidad.",
  },
};

const errorCopy: Record<string, string> = {
  required_action_not_found: "La acción requerida ya no está disponible.",
  required_action_not_open: "La acción ya fue cerrada y no admite más cambios.",
  required_action_assignee_required: "Selecciona un responsable válido.",
  required_action_assignee_not_eligible: "Ese usuario no puede recibir esta acción.",
  required_action_discard_reason_required: "El descarte exige un motivo.",
  required_actions_manage_denied: "Tu rol no puede modificar acciones requeridas.",
  required_action_update_failed: "No se pudo actualizar la acción requerida.",
};

export default function RequiredActionNoticeDialog({
  actionId,
  updated,
  error,
}: {
  actionId: string;
  updated?: string;
  error?: string;
}) {
  if (error) {
    return (
      <NoticeDialog
        eyebrow="NO SE PUDO COMPLETAR"
        title="La acción no cambió"
        tone="error"
        onConfirm={() => window.location.assign(`/admin/acciones/${actionId}`)}
      >
        <p>{errorCopy[error] ?? errorCopy.required_action_update_failed}</p>
      </NoticeDialog>
    );
  }

  const success = updated ? successCopy[updated] : null;
  if (!success) return null;

  return (
    <NoticeDialog
      eyebrow={success.eyebrow}
      title={success.title}
      tone="success"
      onConfirm={() => window.location.assign(`/admin/acciones/${actionId}`)}
    >
      <p>{success.body}</p>
    </NoticeDialog>
  );
}
