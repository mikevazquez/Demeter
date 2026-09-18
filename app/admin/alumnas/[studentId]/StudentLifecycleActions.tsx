"use client";

import { useState } from "react";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { deleteStudent, setStudentLifecycle } from "./actions";

export default function StudentLifecycleActions({
  studentId,
  status,
}: {
  studentId: string;
  status: "active" | "inactive";
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <div className="toolbar-actions mt-4">
        {status === "active" ? (
          <form action={setStudentLifecycle}>
            <input type="hidden" name="student_id" value={studentId} />
            <input type="hidden" name="status" value="inactive" />
            <PendingActionButton className="ghost-button" pendingLabel="Inactivando…">
              Inactivar
            </PendingActionButton>
          </form>
        ) : (
          <form action={setStudentLifecycle}>
            <input type="hidden" name="student_id" value={studentId} />
            <input type="hidden" name="status" value="active" />
            <PendingActionButton className="primary-button" pendingLabel="Reactivando…">
              Reactivar
            </PendingActionButton>
          </form>
        )}

        <button type="button" className="ghost-button" onClick={() => setDeleteOpen(true)}>
          Eliminar alumna
        </button>
      </div>

      {deleteOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-student-title"
        >
          <div className="w-full max-w-lg rounded-3xl border border-rose-300/25 bg-[#190d11] p-6 shadow-2xl">
            <div
              className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-300/25 bg-rose-400/10 text-xl font-bold text-rose-200"
              aria-hidden="true"
            >
              !
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-200">
              Acción irreversible
            </p>
            <h2 id="delete-student-title" className="mt-2 text-2xl font-semibold text-white">
              ¿Eliminar esta alumna?
            </h2>
            <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
              <p>
                El expediente operativo dejará de existir y <strong className="text-white">no podrá
                reactivarse</strong>.
              </p>
              <p>
                Se cancelarán sus reservas futuras sin penalización, se liberarán los créditos
                retenidos y se revocará su acceso al estudio.
              </p>
              <p>
                Su teléfono y correo quedarán disponibles para una nueva alta. Ventas, pagos,
                reembolsos y asistencias históricas necesarias para reportes se conservarán sin
                mantener el expediente activo.
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setDeleteOpen(false)}
              >
                Cancelar
              </button>
              <form action={deleteStudent}>
                <input type="hidden" name="student_id" value={studentId} />
                <PendingActionButton
                  className="w-full rounded-xl bg-rose-500 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  pendingLabel="Eliminando…"
                >
                  Eliminar alumna
                </PendingActionButton>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
