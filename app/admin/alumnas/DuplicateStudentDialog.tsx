"use client";

import { useEffect, useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

export default function DuplicateStudentDialog({ studentName }: { studentName: string }) {
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
    url.searchParams.delete("duplicate");
    window.history.replaceState({}, "", `${url.pathname}${url.search}#alta-rapida`);
  }

  return (
    <NoticeDialog
      eyebrow="Alumna existente"
      title="Ya encontramos este expediente"
      tone="success"
      onConfirm={closeDialog}
    >
      El teléfono ya pertenece a <strong className="text-white">{studentName}</strong>. No se creó
      una alumna nueva ni se modificó el expediente existente.
    </NoticeDialog>
  );
}
