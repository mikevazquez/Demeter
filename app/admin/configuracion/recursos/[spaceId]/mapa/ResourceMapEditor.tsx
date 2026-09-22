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
  element_kind: "resource" | "wall" | "door" | "mirror" | "window" | "label";
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
  const isWall = kind === "wall";

  return {
    id: crypto.randomUUID(),
    resource_id: null,
    element_kind: kind,
    label,
    x: 0.38,
    y: 0.42,
    width: isWall ? 0.28 : isLabel ? 0.16 : isWide ? 0.22 : 0.09,
    height: isWall ? 0.028 : isLabel ? 0.07 : isWide ? 0.055 : 0.13,
    rotation_degrees: 0,
    z_index: isWall ? 0 : 1,
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
    width: 0.075,
    height: 0.105,
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
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
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
            (element) => element.element_kind === "resource" && element.resource_id === resource.id,
          ),
      ),
    [elements, resources],
  );

  const groupedResources = useMemo(() => {
    const groups = new Map<string, ResourceItem[]>();
    for (const resource of unplacedResources) {
      const group = groups.get(resource.typeName) ?? [];
      group.push(resource);
      groups.set(resource.typeName, group);
    }
    return [...groups.entries()];
  }, [unplacedResources]);

  function commit(next: EditableMapElement[]) {
    setHistory((items) => [...items.slice(-39), elements]);
    setFuture([]);
    setElements(next);
  }

  function updateElement(id: string, change: Partial<EditableMapElement>, recordHistory = true) {
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
    addElement({
      ...selected,
      id: crypto.randomUUID(),
      x: clamp(selected.x + 0.03, 0, 1 - selected.width),
      y: clamp(selected.y + 0.03, 0, 1 - selected.height),
    });
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

  function snap(value: number) {
    if (!snapToGrid) return value;
    const grid = 0.025;
    return Math.round(value / grid) * grid;
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
      snap((event.clientX - rect.left - drag.offsetX) / rect.width),
      0,
      1 - element.width,
    );
    const nextY = clamp(
      snap((event.clientY - rect.top - drag.offsetY) / rect.height),
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

  function updateNumeric(
    key: "x" | "y" | "width" | "height" | "rotation_degrees",
    rawValue: string,
  ) {
    if (!selected) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;

    if (key === "rotation_degrees") {
      updateElement(selected.id, { rotation_degrees: ((value % 360) + 360) % 360 });
      return;
    }

    const normalized = value / 100;
    if (key === "x") {
      updateElement(selected.id, { x: clamp(normalized, 0, 1 - selected.width) });
    } else if (key === "y") {
      updateElement(selected.id, { y: clamp(normalized, 0, 1 - selected.height) });
    } else if (key === "width") {
      updateElement(selected.id, { width: clamp(normalized, 0.02, 1 - selected.x) });
    } else {
      updateElement(selected.id, { height: clamp(normalized, 0.02, 1 - selected.y) });
    }
  }

  return (
    <>
      <div className={styles.editorToolbar}>
        <div className={styles.saveStatus}>
          <span className={styles.savedDot} />
          <strong>Guardado</strong>
          <small>Los cambios se guardan al confirmar</small>
        </div>

        <div className={styles.editorToolbarGroup}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={undo}
            disabled={!history.length}
          >
            ↶ Deshacer
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={redo}
            disabled={!future.length}
          >
            ↷ Rehacer
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? "Volver a editar" : "Vista previa"}
          </button>

          <form action={saveSpaceMapAction}>
            <input type="hidden" name="space_id" value={spaceId} />
            <input type="hidden" name="canvas_width" value={initialCanvasWidth} />
            <input type="hidden" name="canvas_height" value={initialCanvasHeight} />
            <input type="hidden" name="elements_json" value={JSON.stringify(elements)} />
            <button className={styles.primaryButton} type="submit">
              Guardar cambios
            </button>
          </form>
        </div>
      </div>

      <div className={styles.editorShell}>
        <aside className={styles.libraryPanel}>
          <div className={styles.panelTabs}>
            <button className={styles.tabActive} type="button">
              Elementos
            </button>
            <button type="button" disabled>
              Configuración
            </button>
          </div>

          <section className={styles.librarySection}>
            <p className={styles.libraryLabel}>ESTRUCTURA</p>
            <div className={styles.palette}>
              <button type="button" onClick={() => addElement(makeReference("wall", "División"))}>
                <span>━</span>
                Pared / División
              </button>
            </div>
          </section>

          <section className={styles.librarySection}>
            <p className={styles.libraryLabel}>REFERENCIAS</p>
            <div className={styles.palette}>
              <button type="button" onClick={() => addElement(makeReference("door", "Puerta"))}>
                <span>▯</span>
                Puerta
              </button>
              <button type="button" onClick={() => addElement(makeReference("mirror", "Espejo"))}>
                <span>▭</span>
                Espejo
              </button>
              <button type="button" onClick={() => addElement(makeReference("window", "Ventana"))}>
                <span>⊟</span>
                Ventana
              </button>
              <button type="button" onClick={() => addElement(makeReference("label", "Etiqueta"))}>
                <span>T</span>
                Texto / Etiqueta
              </button>
            </div>
          </section>

          <section className={styles.librarySection}>
            <p className={styles.libraryLabel}>RECURSOS</p>
            <p className={styles.libraryHelp}>
              Coloca los recursos físicos que ya existen en este espacio.
            </p>

            <div className={styles.unplacedList}>
              {groupedResources.length ? (
                groupedResources.map(([typeName, items]) => (
                  <div className={styles.resourceGroup} key={typeName}>
                    <span>{typeName}</span>
                    {items.map((resource) => (
                      <button
                        type="button"
                        className={styles.unplacedButton}
                        key={resource.id}
                        onClick={() => addElement(resourceElement(resource))}
                      >
                        <b>{resource.shortLabel || resource.name}</b>
                        <small>Colocar</small>
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <p className={styles.libraryEmpty}>Todos los recursos activos están ubicados.</p>
              )}
            </div>

            <a className={styles.addMoreLink} href="/admin/configuracion/recursos">
              + Añadir varios recursos
            </a>
          </section>
        </aside>

        <section className={styles.canvasWrap}>
          <div className={styles.canvasHeader}>
            <div>
              <strong>Mapa del espacio</strong>
              <small>Arrastra los elementos para reproducir la distribución real.</small>
            </div>

            <div className={styles.canvasControls}>
              <span>100%</span>
              <label>
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
                Mostrar cuadrícula
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(event) => setSnapToGrid(event.target.checked)}
                />
                Ajustar a cuadrícula
              </label>
            </div>
          </div>

          <div
            ref={canvasRef}
            className={[
              styles.canvas,
              preview ? styles.canvasPreview : "",
              !showGrid ? styles.canvasNoGrid : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
              <i className={styles.resourceLegend} /> Recurso físico
            </span>
            <span>
              <i className={styles.referenceLegend} /> Referencia
            </span>
            <span>La geometría será idéntica para admin, coach y alumna.</span>
          </div>
        </section>

        <aside className={styles.propertiesPanel}>
          <div className={styles.propertiesHeading}>
            <p className={styles.libraryLabel}>PROPIEDADES</p>
            <strong>{selected?.label ?? "Selecciona un elemento"}</strong>
            <small>
              {selected
                ? selected.element_kind === "resource"
                  ? "Recurso físico"
                  : "Referencia del espacio"
                : "Haz clic en el mapa para editar posición, tamaño y rotación."}
            </small>
          </div>

          {selected ? (
            <div className={styles.inspector}>
              <label className={styles.field}>
                <span>Nombre visible</span>
                <input
                  value={selected.label ?? ""}
                  onChange={(event) =>
                    updateElement(selected.id, { label: event.target.value || null })
                  }
                />
              </label>

              <div className={styles.propertyGrid}>
                <label className={styles.field}>
                  <span>X %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(selected.x * 100)}
                    onChange={(event) => updateNumeric("x", event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>Y %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(selected.y * 100)}
                    onChange={(event) => updateNumeric("y", event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>Ancho %</span>
                  <input
                    type="number"
                    min="2"
                    max="100"
                    value={Math.round(selected.width * 100)}
                    onChange={(event) => updateNumeric("width", event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>Alto %</span>
                  <input
                    type="number"
                    min="2"
                    max="100"
                    value={Math.round(selected.height * 100)}
                    onChange={(event) => updateNumeric("height", event.target.value)}
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span>Rotación</span>
                <div className={styles.rotationField}>
                  <input
                    type="range"
                    min="0"
                    max="359"
                    value={selected.rotation_degrees}
                    onChange={(event) => updateNumeric("rotation_degrees", event.target.value)}
                  />
                  <b>{Math.round(selected.rotation_degrees)}°</b>
                </div>
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
                      x: clamp(0.5 - selected.width / 2, 0, 1 - selected.width),
                      y: clamp(0.5 - selected.height / 2, 0, 1 - selected.height),
                    })
                  }
                >
                  Centrar
                </button>
                <button
                  type="button"
                  disabled={selected.element_kind === "resource"}
                  onClick={duplicateSelected}
                >
                  Duplicar
                </button>
                <button type="button" className={styles.removeButton} onClick={removeSelected}>
                  {selected.element_kind === "resource" ? "Quitar del mapa" : "Eliminar"}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.propertiesEmpty}>
              <span>↖</span>
              Selecciona una referencia o recurso del lienzo.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
