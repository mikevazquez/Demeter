"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import PortalSheet from "@/app/admin/components/PortalSheet";
import { assignReservationResourceAction } from "./actions";
export type AssignmentMapElement = {
  id: string;
  resourceId: string | null;
  kind: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  available: boolean;
  used: number;
  capacity: number;
};
export default function ResourceAssignmentSheet({
  sessionId,
  reservationId,
  name,
  elements,
  currentResourceId,
}: {
  sessionId: string;
  reservationId: string;
  name: string;
  elements: AssignmentMapElement[];
  currentResourceId: string | null;
}) {
  const router = useRouter();
  const close = useCallback(
    () => router.push(`/admin/agenda/${sessionId}/recursos`, { scroll: false }),
    [router, sessionId],
  );
  const [selected, setSelected] = useState(currentResourceId ?? "");
  return (
    <PortalSheet title={`Lugar de ${name}`} onClose={close}>
      <p className="portal-muted">
        Toca un lugar disponible. La reserva y sus créditos se conservan.
      </p>
      <form action={assignReservationResourceAction} className="portal-calendar-form">
        <input type="hidden" name="session_id" value={sessionId} />
        <input type="hidden" name="reservation_id" value={reservationId} />
        <input type="hidden" name="resource_id" value={selected} />
        <div className="portal-assignment-map">
          {elements.map((e) =>
            e.resourceId ? (
              <button
                type="button"
                key={e.id}
                disabled={!e.available && e.resourceId !== currentResourceId}
                aria-pressed={selected === e.resourceId}
                aria-label={`${e.label}, ${e.used} de ${e.capacity} ocupados`}
                data-kind={e.kind}
                style={{
                  left: `${e.x * 100}%`,
                  top: `${e.y * 100}%`,
                  width: `${e.width * 100}%`,
                  height: `${e.height * 100}%`,
                  transform: `rotate(${e.rotation}deg)`,
                }}
                onClick={() => setSelected(e.resourceId!)}
              >
                {e.label}
              </button>
            ) : (
              <span
                key={e.id}
                data-kind={e.kind}
                style={{
                  left: `${e.x * 100}%`,
                  top: `${e.y * 100}%`,
                  width: `${e.width * 100}%`,
                  height: `${e.height * 100}%`,
                  transform: `rotate(${e.rotation}deg)`,
                }}
              >
                {e.label}
              </span>
            ),
          )}
        </div>
        <p className="portal-muted">
          Verde: disponible · gris: lleno o desactivado · borde verde: seleccionado.
        </p>
        <button className="primary-button" disabled={!selected}>
          Guardar lugar
        </button>
      </form>
    </PortalSheet>
  );
}
