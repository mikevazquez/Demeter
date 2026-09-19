"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

type AutomationNoticeProps = {
  error?: string;
  saved?: string;
  version?: string;
};

export default function AutomationNotice({ error, saved, version }: AutomationNoticeProps) {
  const [open, setOpen] = useState(Boolean(error || saved));

  if (!open || (!error && !saved)) return null;

  const close = () => {
    setOpen(false);
    window.history.replaceState(null, "", window.location.pathname);
  };

  if (error) {
    return (
      <NoticeDialog
        eyebrow="Automatizaciones"
        title="No se pudo completar la operación"
        tone="error"
        onConfirm={close}
      >
        {error}
      </NoticeDialog>
    );
  }

  return (
    <NoticeDialog
      eyebrow="Automatizaciones"
      title="Cambio guardado correctamente"
      tone="success"
      onConfirm={close}
    >
      La operación se aplicó correctamente. {version ? `Nueva versión: ${version}.` : ""}
    </NoticeDialog>
  );
}
