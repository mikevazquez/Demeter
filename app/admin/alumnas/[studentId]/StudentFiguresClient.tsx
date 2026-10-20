"use client";

import { useMemo, useState } from "react";

import styles from "./student-figures.module.css";

type FigureRow = {
  elementId: string;
  slug: string;
  name: string;
  originalName: string;
  catalogLevel: string;
  type: string;
  family: string;
  inCoreProgram: boolean;
  completed: boolean;
};

type Props = {
  currentLevelTitle: string;
  figures: FigureRow[];
  totalCatalogFigures: number;
};

const levelLabel: Record<string, string> = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  profesional: "Profesional",
  por_revisar: "Por revisar",
};

export default function StudentFiguresClient({
  currentLevelTitle,
  figures,
  totalCatalogFigures,
}: Props) {
  const [status, setStatus] = useState<"all" | "completed" | "pending">("all");
  const [query, setQuery] = useState("");
  const [baseOnly, setBaseOnly] = useState(false);
  const [limit, setLimit] = useState(120);

  const completedCount = figures.filter((figure) => figure.completed).length;
  const pendingCount = figures.length - completedCount;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return figures.filter((figure) => {
      if (status === "completed" && !figure.completed) return false;
      if (status === "pending" && figure.completed) return false;
      if (baseOnly && !figure.inCoreProgram) return false;
      if (
        needle &&
        !`${figure.name} ${figure.originalName} ${figure.type} ${figure.family}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [baseOnly, figures, query, status]);

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CATÁLOGO TÉCNICO · POLE</p>
          <h2>Figuras de la alumna</h2>
          <p>
            Nivel actual: <strong>{currentLevelTitle}</strong>. Se muestran las figuras disponibles
            hasta su nivel, separando las ya realizadas de las pendientes.
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

      <div className={styles.levelNotice}>
        <span>{currentLevelTitle}</span>
        <p>
          {figures.length} figuras visibles de {totalCatalogFigures} del catálogo Pole.
        </p>
      </div>

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
          ["all", `Todas (${figures.length})`],
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

      {rows.length ? (
        <div className={styles.list}>
          {rows.slice(0, limit).map((figure) => (
            <article className={styles.row} key={figure.elementId}>
              <div className={styles.copy}>
                <div className={styles.titleLine}>
                  <strong>{figure.name}</strong>
                  {figure.originalName !== figure.name ? <span>{figure.originalName}</span> : null}
                </div>
                <div className={styles.meta}>
                  <span>{levelLabel[figure.catalogLevel] ?? figure.catalogLevel}</span>
                  <span>{figure.type}</span>
                  {figure.inCoreProgram ? (
                    <span className={styles.baseBadge}>Programa base</span>
                  ) : null}
                </div>
              </div>

              <div className={styles.state}>
                <span className={figure.completed ? styles.completedBadge : styles.pendingBadge}>
                  {figure.completed ? "Hecha" : "Pendiente"}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          No hay figuras disponibles con estos filtros para el nivel actual.
        </div>
      )}

      {rows.length > limit ? (
        <button className={styles.more} type="button" onClick={() => setLimit(limit + 200)}>
          Mostrar más
        </button>
      ) : null}
    </section>
  );
}
