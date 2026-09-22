"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type StudentResourceChoice = {
  resource_id: string;
  name: string;
  short_label: string | null;
  type_name: string;
  enabled: boolean;
  capacity: number;
  used: number;
  available: number;
};

export type StudentMapElement = {
  id: string;
  resource_id: string | null;
  element_kind: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation_degrees: number;
  z_index: number;
};

function percent(value: number) {
  return `${value * 100}%`;
}

export default function ResourcePicker({
  sessionId,
  returnDate,
  resources,
  elements,
}: {
  sessionId: string;
  returnDate: string;
  resources: StudentResourceChoice[];
  elements: StudentMapElement[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const resourceMap = useMemo(
    () => new Map(resources.map((resource) => [resource.resource_id, resource])),
    [resources],
  );
  const selected = selectedId ? (resourceMap.get(selectedId) ?? null) : null;
  const availableCount = resources.filter(
    (resource) => resource.enabled && resource.available > 0,
  ).length;

  function continueToConfirmation() {
    if (!selectedId) return;
    const query = new URLSearchParams();
    query.set("resource", selectedId);
    if (returnDate) query.set("date", returnDate);
    router.push(`/student/reservar/${sessionId}/confirmar?${query.toString()}`);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
              Elige tu recurso
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Toca el recurso que quieres usar. La distribución coincide con el espacio físico.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
            {availableCount} disponibles
          </span>
        </div>

        <div
          className="relative aspect-[10/7] overflow-hidden rounded-2xl border border-white/10 bg-[#090b10]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        >
          {elements.map((element) => {
            const resource = element.resource_id
              ? (resourceMap.get(element.resource_id) ?? null)
              : null;
            const selectable = Boolean(resource && resource.enabled && resource.available > 0);
            const isSelected = resource?.resource_id === selectedId;
            const isFull = Boolean(resource && resource.available <= 0);
            const label = resource
              ? resource.short_label || resource.name
              : element.label || element.element_kind;

            const commonStyle = {
              left: percent(element.x),
              top: percent(element.y),
              width: percent(element.width),
              height: percent(element.height),
              transform: `rotate(${element.rotation_degrees}deg)`,
              zIndex: element.z_index,
            };

            if (element.element_kind !== "resource") {
              return (
                <span
                  key={element.id}
                  className="absolute grid place-items-center overflow-hidden rounded-lg border border-white/15 bg-white/[0.035] px-1 text-center text-[9px] text-zinc-500"
                  style={commonStyle}
                >
                  {label}
                </span>
              );
            }

            return (
              <button
                key={element.id}
                type="button"
                disabled={!selectable}
                onClick={() => {
                  if (resource) setSelectedId(resource.resource_id);
                }}
                aria-pressed={isSelected}
                aria-label={
                  resource
                    ? `${resource.name}, ${resource.available} de ${resource.capacity} disponibles`
                    : "Recurso no disponible"
                }
                className={[
                  "absolute grid place-items-center rounded-full border px-1 text-center text-[9px] font-semibold transition",
                  isSelected
                    ? "border-fuchsia-300 bg-fuchsia-500/30 text-white ring-2 ring-fuchsia-400/40"
                    : selectable
                      ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25"
                      : isFull
                        ? "cursor-not-allowed border-rose-500/35 bg-rose-500/10 text-rose-300/60"
                        : "cursor-not-allowed border-white/10 bg-white/[0.025] text-zinc-600",
                ].join(" ")}
                style={commonStyle}
              >
                <span className="leading-tight">
                  {label}
                  {resource && resource.capacity > 1 ? (
                    <small className="mt-0.5 block text-[7px] opacity-75">
                      {resource.used}/{resource.capacity}
                    </small>
                  ) : null}
                </span>
              </button>
            );
          })}

          {!elements.length ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-zinc-500">
              El mapa de esta clase todavía no está configurado.
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-fuchsia-400" /> Disponible
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-rose-400/60" /> Completo
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-zinc-600" /> No disponible
          </span>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        {selected ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Seleccionado
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{selected.name}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {selected.type_name}
                {selected.capacity > 1
                  ? ` · ${selected.used}/${selected.capacity} usos ocupados`
                  : ""}
              </p>
            </div>
            <span className="rounded-full bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
              ✓ Listo
            </span>
          </div>
        ) : (
          <p className="text-center text-xs text-zinc-500">
            Selecciona un recurso en el mapa para continuar.
          </p>
        )}

        <button
          type="button"
          onClick={continueToConfirmation}
          disabled={!selected}
          className="mt-4 min-h-11 w-full rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
        >
          Continuar
        </button>
      </section>
    </div>
  );
}
