"use client";

import { useEffect, useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function OnboardingCompletedDialog() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    document.getElementById("confirmar-alta")?.scrollIntoView({
      behavior: "auto",
      block: "center",
    });
  }, []);

  if (!open) return null;

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("completed");
    window.history.replaceState({}, "", `${url.pathname}${url.search}#confirmar-alta`);
  }

  return (
    <NoticeDialog
      eyebrow="Alta registrada"
      title="La operación se guardó correctamente"
      tone="success"
      onConfirm={closeDialog}
    >
      La alumna, su compra y sus condiciones quedaron vinculadas al mismo expediente.
    </NoticeDialog>
  );
}
