"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function RewardAdjustedNotice({ saved }: { saved?: string }) {
  const [open, setOpen] = useState(saved === "adjusted");

  if (!open || saved !== "adjusted") return null;

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <NoticeDialog
      eyebrow="Recompensas"
      title="Ajuste guardado correctamente"
      tone="success"
      onConfirm={closeDialog}
    >
      La recompensa quedó ajustada y el motivo quedó registrado en auditoría.
    </NoticeDialog>
  );
}
