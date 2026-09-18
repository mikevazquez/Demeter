"use client";

import { useEffect, useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

type DuplicateStudentDialogProps = {
  studentName: string;
  archived: boolean;
};

export default function DuplicateStudentDialog({
  studentName,
  archived,
}: DuplicateStudentDialogProps) {
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
      eyebrow={archived ? "Expediente archivado" : "Alumna existente"}
      title={archived ? "Esta alumna ya estaba registrada" : "Ya encontramos este expediente"}
      tone={archived ? "warning" : "success"}
      onConfirm={closeDialog}
    >
      El teléfono ya pertenece a <strong className="text-white">{studentName}</strong>.{" "}
      {archived
        ? "El expediente se conserva archivado y no se creó otra alumna."
        : "No se creó una alumna nueva ni se modificó el expediente existente."}
    </NoticeDialog>
  );
}
