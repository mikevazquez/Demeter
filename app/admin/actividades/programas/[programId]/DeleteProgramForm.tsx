"use client";

import { useState } from "react";
import { deleteProgram } from "../actions";

export function DeleteProgramForm({
  programId,
  programName,
}: {
  programId: string;
  programName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      aria-labelledby="delete-program-title"
      style={{
        marginTop: 32,
        padding: 20,
        border: "1px solid #fecaca",
        borderRadius: 16,
        background: "#fff7f7",
      }}
    >
      <h2 id="delete-program-title" style={{ marginTop: 0 }}>
        Eliminar taller
      </h2>
      <p style={{ marginBottom: 16 }}>
        Cancela las sesiones futuras y sus reservas, desactiva los productos del programa y lo
        retira de Actividades, Agenda y Demi. El historial se conserva. Si existen pagos
        registrados, la eliminación se bloquea hasta corregir esas ventas.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          style={{
            border: 0,
            borderRadius: 12,
            padding: "12px 16px",
            background: "#b91c1c",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Eliminar taller
        </button>
      ) : (
        <form action={deleteProgram}>
          <input type="hidden" name="program_id" value={programId} />
          <p>
            ¿Eliminar <strong>{programName}</strong>? Esta acción cancelará sus reservas activas.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="submit"
              style={{
                border: 0,
                borderRadius: 12,
                padding: "12px 16px",
                background: "#b91c1c",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Sí, eliminar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 12,
                padding: "12px 16px",
                background: "#fff",
                color: "#183047",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
