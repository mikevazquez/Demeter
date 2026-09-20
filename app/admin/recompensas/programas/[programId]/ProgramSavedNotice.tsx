"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function ProgramSavedNotice({ saved }: { saved?: string }) {
  const [open, setOpen] = useState(Boolean(saved));

  if (!open || !saved) return null;

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <NoticeDialog
      eyebrow="Programas"
      title="Cambio guardado correctamente"
      tone="success"
      onConfirm={closeDialog}
    >
      La operación se aplicó correctamente.
    </NoticeDialog>
  );
}
