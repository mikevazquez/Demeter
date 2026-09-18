"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function StudentDeletedDialog({
  cancelledReservations,
}: {
  cancelledReservations: number;
}) {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("deleted");
    url.searchParams.delete("cancelled");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  const safeCancelled = Number.isFinite(cancelledReservations)
    ? Math.max(0, Math.trunc(cancelledReservations))
    : 0;

  return (
    <NoticeDialog
      eyebrow="Alumna eliminada"
      title="El expediente operativo fue eliminado"
      tone="success"
      onConfirm={closeDialog}
    >
      La alumna ya no aparece en el directorio y no puede reactivarse.
      {safeCancelled > 0
        ? ` Se cancelaron ${safeCancelled} reserva${safeCancelled === 1 ? "" : "s"} futura${safeCancelled === 1 ? "" : "s"} sin penalización y se liberaron los créditos retenidos.`
        : " No tenía reservas futuras que cancelar."}
    </NoticeDialog>
  );
}
