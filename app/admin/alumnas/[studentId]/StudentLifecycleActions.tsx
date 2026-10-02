"use client";

import { useState } from "react";

import AdminDialogFrame from "@/app/admin/components/AdminDialogFrame";
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
        <AdminDialogFrame
          eyebrow="Acción irreversible"
          title="¿Eliminar esta alumna?"
          tone="danger"
          onClose={() => setDeleteOpen(false)}
          labelledBy="delete-student-title"
          footer={
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDeleteOpen(false)}
              >
                Cancelar
              </button>
              <form action={deleteStudent}>
                <input type="hidden" name="student_id" value={studentId} />
                <PendingActionButton className="sf-dialog-danger" pendingLabel="Eliminando…">
                  Eliminar alumna
                </PendingActionButton>
              </form>
            </>
          }
        >
          <p>
            El expediente operativo dejará de existir y <strong>no podrá reactivarse</strong>.
          </p>
          <p>
            Se cancelarán sus reservas futuras sin penalización, se liberarán los créditos retenidos
            y se revocará su acceso al estudio.
          </p>
          <p>
            Su teléfono y correo quedarán disponibles para una nueva alta. Ventas, pagos, reembolsos
            y asistencias históricas necesarias para reportes se conservarán.
          </p>
        </AdminDialogFrame>
      ) : null}
    </>
  );
}
