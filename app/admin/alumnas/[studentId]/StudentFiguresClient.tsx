"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import catalog from "@/app/admin/catalogo/pole-catalog-data.json";

import { setStudentFigureProgressAction } from "./figure-actions";
import styles from "./student-figures.module.css";

type FigureLevel = "Principiante" | "Intermedio" | "Avanzado" | "Profesional" | "Por revisar";

type Figure = {
  id: string;
  nombre: string;
  nombre_es: string;
  nivel: FigureLevel;
  tipo: string;
  familia: string;
  programa_base: boolean;
};

type ElementMapItem = {
  slug: string;
  elementId: string;
};

type Props = {
  studentId: string;
  canWrite: boolean;
  elementMap: ElementMapItem[];
  completedElementIds: string[];
};

const figures = catalog.figuras as Figure[];

function ProgressButton({ completed }: { completed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={completed ? styles.undoButton : styles.doneButton}
      disabled={pending}
    >
      {pending ? "Guardando…" : completed ? "Mover a pendiente" : "Marcar hecha"}
    </button>
  );
}

export default function StudentFiguresClient({
  studentId,
  canWrite,
  elementMap,
  completedElementIds,
}: Props) {
  const [status, setStatus] = useState<"all" | "completed" | "pending">("all");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [baseOnly, setBaseOnly] = useState(false);
  const [limit, setLimit] = useState(120);

  const elementIdBySlug = useMemo(
    () => new Map(elementMap.map((item) => [item.slug, item.elementId])),
    [elementMap],
  );
  const completed = useMemo(() => new Set(completedElementIds), [completedElementIds]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return figures.filter((figure) => {
      const elementId = elementIdBySlug.get(figure.id);
      if (!elementId) return false;

      const isCompleted = completed.has(elementId);
      if (status === "completed" && !isCompleted) return false;
      if (status === "pending" && isCompleted) return false;
      if (level && figure.nivel !== level) return false;
      if (baseOnly && !figure.programa_base) return false;
      if (
        needle &&
        !`${figure.nombre} ${figure.nombre_es} ${figure.tipo} ${figure.familia}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }

      return true;
    });
  }, [baseOnly, completed, elementIdBySlug, level, query, status]);

  const completedCount = completedElementIds.length;
  const pendingCount = Math.max(elementMap.length - completedCount, 0);

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CATÁLOGO TÉCNICO · POLE</p>
          <h2>Figuras de la alumna</h2>
          <p>
            El progreso cambia únicamente cuando un instructor marca una figura como hecha o la
            devuelve a pendiente.
          </p>
        </div>
        <div className={styles.summary} aria-label="Resumen de progreso">
          <span>
            <b>{completedCount}</b>
            Hechas
          </span>
          <span>
            <b>{pendingCount}</b>
            Pendientes
          </span>
        </div>
      </header>

      <div className={styles.filters}>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(120);
          }}
          placeholder="Buscar figura…"
          aria-label="Buscar figura"
        />
        <select
          value={level}
          onChange={(event) => {
            setLevel(event.target.value);
            setLimit(120);
          }}
          aria-label="Filtrar por nivel"
        >
          <option value="">Todos los niveles</option>
          <option value="Principiante">Principiante</option>
          <option value="Intermedio">Intermedio</option>
          <option value="Avanzado">Avanzado</option>
          <option value="Profesional">Profesional</option>
          <option value="Por revisar">Por revisar</option>
        </select>
        <label className={styles.baseToggle}>
          <input
            type="checkbox"
            checked={baseOnly}
            onChange={(event) => {
              setBaseOnly(event.target.checked);
              setLimit(120);
            }}
          />
          Solo programa base
        </label>
      </div>

      <div className={styles.statusTabs} aria-label="Estado de figuras">
        {[
          ["all", `Todas (${elementMap.length})`],
          ["completed", `Hechas (${completedCount})`],
          ["pending", `Pendientes (${pendingCount})`],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={status === key}
            onClick={() => {
              setStatus(key as typeof status);
              setLimit(120);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <p className={styles.resultCount}>{rows.length} figuras</p>

      <div className={styles.list}>
        {rows.slice(0, limit).map((figure) => {
          const elementId = elementIdBySlug.get(figure.id)!;
          const isCompleted = completed.has(elementId);

          return (
            <article className={styles.row} key={figure.id}>
              <div className={styles.copy}>
                <div className={styles.titleLine}>
                  <strong>{figure.nombre_es || figure.nombre}</strong>
                  {figure.nombre_es && figure.nombre_es !== figure.nombre ? (
                    <span>{figure.nombre}</span>
                  ) : null}
                </div>
                <div className={styles.meta}>
                  <span>{figure.nivel}</span>
                  <span>{figure.tipo}</span>
                  {figure.programa_base ? <span className={styles.baseBadge}>Programa base</span> : null}
                </div>
              </div>

              <div className={styles.state}>
                <span className={isCompleted ? styles.completedBadge : styles.pendingBadge}>
                  {isCompleted ? "Hecha" : "Pendiente"}
                </span>
                {canWrite ? (
                  <form action={setStudentFigureProgressAction}>
                    <input type="hidden" name="student_id" value={studentId} />
                    <input type="hidden" name="element_id" value={elementId} />
                    <input type="hidden" name="completed" value={isCompleted ? "false" : "true"} />
                    <ProgressButton completed={isCompleted} />
                  </form>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {rows.length > limit ? (
        <button className={styles.more} type="button" onClick={() => setLimit(limit + 200)}>
          Mostrar más
        </button>
      ) : null}
    </section>
  );
}
