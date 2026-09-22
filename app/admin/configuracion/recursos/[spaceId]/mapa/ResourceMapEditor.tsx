"use client";

import { useMemo, useRef, useState } from "react";

import { saveSpaceMapAction } from "../../actions";
import styles from "../../recursos.module.css";

type ResourceItem = {
  id: string;
  name: string;
  shortLabel: string | null;
  active: boolean;
  typeName: string;
};

export type EditableMapElement = {
  id: string;
  resource_id: string | null;
  element_kind: "resource" | "door" | "mirror" | "window" | "label";
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation_degrees: number;
  z_index: number;
  metadata: Record<string, unknown>;
};

type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
} | null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function makeReference(
  kind: EditableMapElement["element_kind"],
  label: string,
): EditableMapElement {
  const isLabel = kind === "label";
  const isWide = kind === "mirror" || kind === "window";

  return {
    id: crypto.randomUUID(),
    resource_id: null,
    element_kind: kind,
    label,
    x: 0.42,
    y: 0.42,
    width: isLabel ? 0.16 : isWide ? 0.2 : 0.09,
    height: isLabel ? 0.07 : isWide ? 0.055 : 0.13,
    rotation_degrees: 0,
    z_index: 1,
    metadata: {},
  };
}

function resourceElement(resource: ResourceItem): EditableMapElement {
  return {
    id: crypto.randomUUID(),
    resource_id: resource.id,
    element_kind: "resource",
    label: resource.shortLabel || resource.name,
    x: 0.44,
    y: 0.42,
    width: 0.085,
    height: 0.12,
    rotation_degrees: 0,
    z_index: 2,
    metadata: {},
  };
}

export function ResourceMapEditor({
  spaceId,
  resources,
  initialElements,
  initialCanvasWidth,
  initialCanvasHeight,
}: {
  spaceId: string;
  resources: ResourceItem[];
  initialElements: EditableMapElement[];
  initialCanvasWidth: number;
  initialCanvasHeight: number;
}) {
  const [elements, setElements] = useState(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<EditableMapElement[][]>([]);
  const [future, setFuture] = useState<EditableMapElement[][]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);

  const selected = elements.find((item) => item.id === selectedId) ?? null;

  const unplacedResources = useMemo(
    () =>
      resources.filter(
        (resource) =>
          resource.active &&
          !elements.some(
            (element) =>
              element.element_kind === "resource" && element.resource_id === resource.id,
          ),
      ),
    [elements, resources],
  );

  function commit(next: EditableMapElement[]) {
    setHistory((items) => [...items.slice(-39), elements]);
    setFuture([]);
    setElements(next);
  }

  function updateElement(
    id: string,
    change: Partial<EditableMapElement>,
    recordHistory = true,
  ) {
    const next = elements.map((item) => (item.id === id ? { ...item, ...change } : item));
    if (recordHistory) {
      commit(next);
    } else {
      setElements(next);
    }
  }

  function addElement(element: EditableMapElement) {
    commit([...elements, element]);
    setSelectedId(element.id);
  }

  function removeSelected() {
    if (!selected) return;
    commit(elements.filter((item) => item.id !== selected.id));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selected || selected.element_kind === "resource") return;
    const copy = {
      ...selected,
      id: crypto.randomUUID(),
      x: clamp(selected.x + 0.03, 0, 1 - selected.width),
      y: clamp(selected.y + 0.03, 0, 1 - selected.height),
    };
    addElement(copy);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [elements, ...items].slice(0, 40));
    setElements(previous);
    setHistory((items) => items.slice(0, -1));
    setSelectedId(null);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, elements].slice(-40));
    setElements(next);
    setFuture((items) => items.slice(1));
    setSelectedId(null);
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    element: EditableMapElement,
  ) {
    if (preview) return;

    const markerRect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id: element.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - markerRect.left,
      offsetY: event.clientY - markerRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(element.id);
    setHistory((items) => [...items.slice(-39), elements]);
    setFuture([]);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas || drag.pointerId !== event.pointerId || preview) return;

    const element = elements.find((item) => item.id === drag.id);
    if (!element) return;

    const rect = canvas.getBoundingClientRect();
    const nextX = clamp(
      (event.clientX - rect.left - drag.offsetX) / rect.width,
      0,
      1 - element.width,
    );
    const nextY = clamp(
      (event.clientY - rect.top - drag.offsetY) / rect.height,
      0,
      1 - element.height,
    );

    updateElement(drag.id, { x: nextX, y: nextY }, false);
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <>
      <div className={styles.editorToolbar}>
        <div className={styles.editorToolbarGroup}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={undo}
            disabled={!history.length}
          >
            Deshacer
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={redo}
            disabled={!future.length}
          >
            Rehacer
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? "Volver a editar" : "Vista previa"}
          </button>
        </div>

        <form action={saveSpaceMapAction}>
          <input type="hidden" name="space_id" value={spaceId} />
          <input type="hidden" name="canvas_width" value={initialCanvasWidth} />
          <input type="hidden" name="canvas_height" value={initialCanvasHeight} />
          <input type="hidden" name="elements_json" value={JSON.stringify(elements)} />
          <button className={styles.primaryButton} type="submit">
            Guardar mapa
          </button>
        </form>
      </div>

      <div className={styles.editorShell}>
        <section className={styles.canvasWrap}>
          <div
            ref={canvasRef}
            className={`${styles.canvas} ${preview ? styles.canvasPreview : ""}`}
          >
            {elements.map((element) => (
              <button
                type="button"
                key={element.id}
                className={styles.mapElement}
                data-kind={element.element_kind}
                data-selected={selectedId === element.id}
                onPointerDown={(event) => onPointerDown(event, element)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onClick={() => {
                  if (!preview) setSelectedId(element.id);
                }}
                style={{
                  left: `${element.x * 100}%`,
                  top: `${element.y * 100}%`,
                  width: `${element.width * 100}%`,
                  height: `${element.height * 100}%`,
                  transform: `rotate(${element.rotation_degrees}deg)`,
                  zIndex: element.z_index,
                  pointerEvents: preview ? "none" : "auto",
                }}
                aria-label={element.label ?? element.element_kind}
              >
                {element.label ?? element.element_kind}
              </button>
            ))}
          </div>

          <div className={styles.legend}>
            <span>
              <i /> Recurso físico
            </span>
            <span>Las referencias solo ayudan a ubicarse; no se reservan.</span>
          </div>
        </section>

        <aside className={styles.sidePanel}>
          <section className={styles.sideCard}>
            <h2>Agregar referencia</h2>
            <p>Marca elementos fijos del espacio para que el mapa sea fácil de reconocer.</p>
            <div className={styles.palette}>
              <button type="button" onClick={() => addElement(makeReference("door", "Puerta"))}>
                Puerta
              </button>
              <button
                type="button"
                onClick={() => addElement(makeReference("mirror", "Espejo"))}
              >
                Espejo
              </button>
              <button
                type="button"
                onClick={() => addElement(makeReference("window", "Ventana"))}
              >
                Ventana
              </button>
              <button
                type="button"
                onClick={() => addElement(makeReference("label", "Referencia"))}
              >
                Texto
              </button>
            </div>
          </section>

          <section className={styles.sideCard}>
            <h3>Recursos sin ubicar</h3>
            <p>Coloca cada recurso exactamente donde está físicamente.</p>
            <div className={styles.unplacedList}>
              {unplacedResources.length ? (
                unplacedResources.map((resource) => (
                  <button
                    type="button"
                    className={styles.unplacedButton}
                    key={resource.id}
                    onClick={() => addElement(resourceElement(resource))}
                  >
                    <span>{resource.shortLabel || resource.name}</span>
                    <small>{resource.typeName}</small>
                  </button>
                ))
              ) : (
                <p>Todos los recursos activos ya están ubicados.</p>
              )}
            </div>
          </section>

          <section className={styles.sideCard}>
            <h3>Elemento seleccionado</h3>
            {selected ? (
              <div className={styles.inspector}>
                <label className={styles.field}>
                  <span>Etiqueta visible</span>
                  <input
                    value={selected.label ?? ""}
                    onChange={(event) =>
                      updateElement(
                        selected.id,
                        { label: event.target.value || null },
                        false,
                      )
                    }
                    onBlur={() => {
                      setHistory((items) => [...items.slice(-39), elements]);
                      setFuture([]);
                    }}
                  />
                </label>

                <div className={styles.inspectorActions}>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selected.id, {
                        rotation_degrees: (selected.rotation_degrees + 15) % 360,
                      })
                    }
                  >
                    Girar +15°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selected.id, {
                        rotation_degrees:
                          (selected.rotation_degrees - 15 + 360) % 360,
                      })
                    }
                  >
                    Girar −15°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selected.id, {
                        x: clamp(0.5 - selected.width / 2, 0, 1 - selected.width),
                      })
                    }
                  >
                    Centrar X
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement(selected.id, {
                        y: clamp(0.5 - selected.height / 2, 0, 1 - selected.height),
                      })
                    }
                  >
                    Centrar Y
                  </button>
                  <button
                    type="button"
                    disabled={selected.element_kind === "resource"}
                    onClick={duplicateSelected}
                  >
                    Duplicar
                  </button>
                  <button type="button" onClick={removeSelected}>
                    {selected.element_kind === "resource"
                      ? "Quitar del mapa"
                      : "Eliminar"}
                  </button>
                </div>
              </div>
            ) : (
              <p>Toca un elemento del mapa para editarlo.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
