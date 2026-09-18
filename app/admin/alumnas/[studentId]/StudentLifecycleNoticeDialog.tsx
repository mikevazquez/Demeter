"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function StudentLifecycleNoticeDialog({
  result,
  error,
}: {
  result?: "active" | "inactive";
  error?: string;
}) {
  const [open, setOpen] = useState(Boolean(result || error));

  if (!open || (!result && !error)) return null;

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("lifecycle");
    url.searchParams.delete("lifecycle_error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}#estado-alumna`);
  }

  if (error) {
    return (
      <NoticeDialog
        eyebrow="No se guardó el cambio"
        title={
          error === "delete" ? "No pudimos eliminar la alumna" : "No pudimos cambiar el estado"
        }
        tone="error"
        onConfirm={closeDialog}
      >
        El expediente no fue modificado. Revisa tu conexión o permisos e inténtalo de nuevo.
      </NoticeDialog>
    );
  }

  const resultMessage =
    result === "inactive"
      ? "Se conserva el mismo expediente y sus reservas futuras existentes. Mientras permanezca inactiva no podrá crear nuevas reservas ni usar el portal del estudio."
      : "Se conserva el mismo expediente e historial. La alumna vuelve a tener acceso operativo y puede crear nuevas reservas.";

  return (
    <NoticeDialog
      eyebrow={result === "inactive" ? "Alumna inactiva" : "Alumna reactivada"}
      title={result === "inactive" ? "El expediente quedó inactivo" : "El acceso quedó reactivado"}
      tone="success"
      onConfirm={closeDialog}
    >
      {resultMessage}
    </NoticeDialog>
  );
}
