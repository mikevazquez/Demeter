"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

type AutomationNoticeProps = {
  error?: string;
  saved?: string;
  version?: string | number;
};

export default function AutomationNotice({ error }: AutomationNoticeProps) {
  const [open, setOpen] = useState(Boolean(error));

  if (!open || !error) return null;

  const close = () => {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

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
