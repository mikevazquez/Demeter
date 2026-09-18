"use client";

import { useEffect, useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function StudentFormErrorDialog({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    document.getElementById("alta-rapida")?.scrollIntoView({
      behavior: "auto",
      block: "center",
    });
  }, []);

  if (!open) return null;

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}#alta-rapida`);
  }

  return (
    <NoticeDialog
      eyebrow="Revisa los datos"
      title={title}
      tone="error"
      onConfirm={closeDialog}
    >
      {message}
    </NoticeDialog>
  );
}
