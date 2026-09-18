"use client";

import { useEffect, useState } from "react";

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
      behavior: "instant",
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-student-title"
    >
      <div
        className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${
          archived
            ? "border-amber-300/25 bg-[#17130d]"
            : "border-fuchsia-300/25 bg-[#160d16]"
        }`}
      >
        <div
          className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border text-xl font-bold ${
            archived
              ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
              : "border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-200"
          }`}
          aria-hidden="true"
        >
          {archived ? "!" : "✓"}
        </div>

        <p
          className={`text-xs font-semibold uppercase tracking-[0.2em] ${
            archived ? "text-amber-200" : "text-fuchsia-300"
          }`}
        >
          {archived ? "Expediente archivado" : "Alumna existente"}
        </p>

        <h2 id="duplicate-student-title" className="mt-2 text-2xl font-semibold text-white">
          {archived ? "Esta alumna ya estaba registrada" : "Ya encontramos este expediente"}
        </h2>

        <p className="mt-3 text-sm leading-6 text-zinc-300">
          El teléfono ya pertenece a <strong className="text-white">{studentName}</strong>.{" "}
          {archived
            ? "El expediente se conserva archivado y no se creó otra alumna."
            : "No se creó una alumna nueva ni se modificó el expediente existente."}
        </p>

        <button
          type="button"
          className="primary-button mt-6 w-full"
          onClick={closeDialog}
        >
          Aceptar
        </button>
      </div>
    </div>
  );
}
