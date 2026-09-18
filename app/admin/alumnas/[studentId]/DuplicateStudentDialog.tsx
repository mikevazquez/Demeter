"use client";

import { useState } from "react";

type DuplicateStudentDialogProps = {
  studentName: string;
  mode: "active" | "archived";
};

export default function DuplicateStudentDialog({
  studentName,
  mode,
}: DuplicateStudentDialogProps) {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  const archived = mode === "archived";

  function closeDialog() {
    setOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("alta");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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
            ? "Abrimos su expediente archivado y no se creó otra alumna."
            : "Abrimos su Perfil 360 y no se creó ningún registro duplicado."}
        </p>

        <div className="mt-6 grid gap-3">
          {archived ? (
            <a
              className="primary-button text-center"
              href="#estado-alumna"
              onClick={closeDialog}
            >
              Revisar estado
            </a>
          ) : null}

          <button
            type="button"
            className={archived ? "ghost-button" : "primary-button"}
            onClick={closeDialog}
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
