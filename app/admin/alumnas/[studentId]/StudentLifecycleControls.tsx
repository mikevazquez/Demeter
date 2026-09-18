"use client";

import { useState } from "react";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { deleteStudent, setStudentLifecycle } from "./actions";

type ConfirmMode = "inactive" | "delete" | null;

export default function StudentLifecycleControls({
  studentId,
  studentName,
  lifecycleStatus,
}: {
  studentId: string;
  studentName: string;
  lifecycleStatus: string;
}) {
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);

  return (
    <>
      <div className="toolbar-actions">
        {lifecycleStatus === "inactive" ? (
          <form action={setStudentLifecycle}>
            <input type="hidden" name="student_id" value={studentId} />
            <input type="hidden" name="status" value="active" />
            <PendingActionButton className="primary-button" pendingLabel="Reactivando…">
              Reactivar
            </PendingActionButton>
          </form>
        ) : (
          <button
            className="ghost-button"
            type="button"
            onClick={() => setConfirmMode("inactive")}
          >
            Inactivar
          </button>
        )}

        <button className="ghost-button" type="button" onClick={() => setConfirmMode("delete")}>
          Eliminar alumna
        </button>
      </div>

      {confirmMode ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-lifecycle-confirm-title"
        >
          <div
            className={
              confirmMode === "delete"
                ? "w-full max-w-md rounded-3xl border border-rose-300/25 bg-[#190d11] p-6 shadow-2xl"
                : "w-full max-w-md rounded-3xl border border-amber-300/25 bg-[#17130d] p-6 shadow-2xl"
            }
          >
            <div
              className={
                confirmMode === "delete"
                  ? "mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-300/25 bg-rose-400/10 text-xl font-bold text-rose-200"
                  : "mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-xl font-bold text-amber-200"
              }
              aria-hidden="true"
            >
              !
            </div>

            <p
              className={
                confirmMode === "delete"
                  ? "text-xs font-semibold uppercase tracking-[0.2em] text-rose-200"
                  : "text-xs font-semibold uppercase tracking-[0.2em] text-amber-200"
              }
            >
              {confirmMode === "delete" ? "Acción irreversible" : "Cambiar estado"}
            </p>
            <h2
              id="student-lifecycle-confirm-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {confirmMode === "delete" ? "¿Eliminar a esta alumna?" : "¿Inactivar a esta alumna?"}
            </h2>

            <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-300">
              <p>
                Estás modificando el expediente de{" "}
                <strong className="text-white">{studentName}</strong>.
              </p>
              {confirmMode === "delete" ? (
                <>
                  <p>
                    Se eliminará de la operación normal, se revocará su acceso al portal y se
                    cancelarán sin penalización sus reservas futuras.
                  </p>
                  <p>
                    Esta acción no se puede deshacer. Si vuelve al estudio, deberá registrarse como
                    una alumna nueva.
                  </p>
                </>
              ) : (
                <p>
                  Se conservará todo su expediente e historial. Sus reservas futuras se cancelarán
                  sin penalización y podrás reactivarla después sin volver a registrarla.
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button className="ghost-button" type="button" onClick={() => setConfirmMode(null)}>
                Cancelar
              </button>

              {confirmMode === "delete" ? (
                <form action={deleteStudent}>
                  <input type="hidden" name="student_id" value={studentId} />
                  <PendingActionButton className="primary-button" pendingLabel="Eliminando…">
                    Eliminar alumna
                  </PendingActionButton>
                </form>
              ) : (
                <form action={setStudentLifecycle}>
                  <input type="hidden" name="student_id" value={studentId} />
                  <input type="hidden" name="status" value="inactive" />
                  <PendingActionButton className="primary-button" pendingLabel="Inactivando…">
                    Inactivar
                  </PendingActionButton>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
