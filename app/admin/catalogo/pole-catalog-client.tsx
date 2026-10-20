"use client";

import { useMemo, useState } from "react";

import data from "./pole-catalog-data.json";
import styles from "./catalogo.module.css";

type Level = "Principiante" | "Intermedio" | "Avanzado" | "Profesional" | "Por revisar";

type Figure = {
  id: string;
  nombre: string;
  nombre_es: string;
  nivel: Level;
  tipo: string;
  familia: string;
  programa_base: boolean;
  prerrequisitos_sugeridos: string[];
  pagina: number;
  nivel_verificar: boolean;
};

type Combo = {
  nivel: Exclude<Level, "Profesional" | "Por revisar">;
  figuras: string[];
};

const figures = data.figuras as Figure[];
const combos = data.combos_base as Combo[];

const LEVELS: Level[] = ["Principiante", "Intermedio", "Avanzado", "Profesional", "Por revisar"];

const LEVEL_CLASS: Record<Level, string> = {
  Principiante: styles.beginner,
  Intermedio: styles.intermediate,
  Avanzado: styles.advanced,
  Profesional: styles.professional,
  "Por revisar": styles.review,
};

const byId = new Map(figures.map((figure) => [figure.id, figure]));

function FigureName({ figure }: { figure: Figure }) {
  if (figure.nombre_es && figure.nombre_es !== figure.nombre) {
    return (
      <>
        {figure.nombre_es} <span className={styles.english}>· {figure.nombre}</span>
      </>
    );
  }
  return <>{figure.nombre}</>;
}

function LevelTag({ level }: { level: Level }) {
  return (
    <span className={`${styles.level} ${LEVEL_CLASS[level]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {level}
    </span>
  );
}

export default function PoleCatalogClient() {
  const [view, setView] = useState<"base" | "all" | "combos">("base");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [type, setType] = useState("");
  const [levels, setLevels] = useState<Set<Level>>(new Set());
  const [limit, setLimit] = useState(150);

  const pool = useMemo(
    () => (view === "base" ? figures.filter((figure) => figure.programa_base) : figures),
    [view],
  );

  const counts = useMemo(() => {
    const levelCounts = new Map<Level, number>();
    for (const figure of figures) {
      levelCounts.set(figure.nivel, (levelCounts.get(figure.nivel) ?? 0) + 1);
    }
    return levelCounts;
  }, []);

  const families = useMemo(
    () =>
      [...new Set(pool.map((figure) => figure.familia))].sort((a, b) => a.localeCompare(b, "es")),
    [pool],
  );

  const types = useMemo(
    () => [...new Set(pool.map((figure) => figure.tipo))].sort((a, b) => a.localeCompare(b, "es")),
    [pool],
  );

  const visibleLevels = useMemo(
    () => LEVELS.filter((level) => pool.some((figure) => figure.nivel === level)),
    [pool],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pool.filter((figure) => {
      const matchesSearch =
        !needle || `${figure.nombre} ${figure.nombre_es}`.toLowerCase().includes(needle);
      const matchesFamily = !family || figure.familia === family;
      const matchesType = !type || figure.tipo === type;
      const matchesLevel = !levels.size || levels.has(figure.nivel);
      return matchesSearch && matchesFamily && matchesType && matchesLevel;
    });
  }, [pool, query, family, type, levels]);

  const shown = filtered.slice(0, limit);

  function changeView(next: "base" | "all" | "combos") {
    setView(next);
    setLimit(150);
    setFamily("");
    setType("");
    setLevels(new Set());
  }

  function toggleLevel(level: Level) {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
    setLimit(150);
  }

  function goToFigure(id: string) {
    setView("all");
    setQuery("");
    setFamily("");
    setType("");
    setLevels(new Set());
    window.setTimeout(() => {
      const element = document.getElementById(`catalog-figure-${id}`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.classList.add(styles.flash);
      window.setTimeout(() => element?.classList.remove(styles.flash), 1400);
    }, 0);
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.eyebrow}>Demeter · Studio Flow · Catálogo interno</div>
          <h1>Catálogo de figuras de Pole</h1>
          <p className={styles.lede}>
            Herramienta de consulta del programa técnico de Pole. Los nombres en español y los
            prerrequisitos del programa base se conservan como propuestas de trabajo hasta su
            validación docente.
          </p>

          <div className={styles.counts}>
            <span className={styles.count}>
              <b>{figures.length}</b> figuras
            </span>
            <span className={styles.count}>
              <b>{figures.filter((figure) => figure.programa_base).length}</b> en programa base
            </span>
            {LEVELS.filter((level) => counts.has(level)).map((level) => (
              <span className={styles.count} key={level}>
                <span className={`${styles.dot} ${LEVEL_CLASS[level]}`} aria-hidden="true" />
                {counts.get(level)} {level.toLowerCase()}
              </span>
            ))}
          </div>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="Vistas del catálogo">
          {[
            ["base", "Programa base"],
            ["all", "Catálogo completo"],
            ["combos", "Combos base"],
          ].map(([key, label]) => (
            <button
              className={styles.tab}
              type="button"
              role="tab"
              aria-selected={view === key}
              key={key}
              onClick={() => changeView(key as "base" | "all" | "combos")}
            >
              {label}
            </button>
          ))}
        </div>

        {view !== "combos" ? (
          <section>
            <div className={styles.filters}>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(150);
                }}
                placeholder="Buscar figura (inglés o español)"
                aria-label="Buscar figura"
              />

              {view === "all" ? (
                <select
                  aria-label="Familia"
                  value={family}
                  onChange={(event) => setFamily(event.target.value)}
                >
                  <option value="">Todas las familias</option>
                  {families.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              ) : null}

              <select
                aria-label="Tipo"
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="">Todos los tipos</option>
                {types.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.chips}>
              {visibleLevels.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={styles.chip}
                  aria-pressed={levels.has(level)}
                  onClick={() => toggleLevel(level)}
                >
                  <span className={`${styles.dot} ${LEVEL_CLASS[level]}`} aria-hidden="true" />
                  {level}
                </button>
              ))}
            </div>

            <p className={styles.result}>
              {filtered.length} {filtered.length === 1 ? "figura" : "figuras"}
            </p>

            <div className={styles.list}>
              {shown.length ? (
                shown.map((figure) => (
                  <article
                    className={styles.row}
                    id={`catalog-figure-${figure.id}`}
                    key={figure.id}
                  >
                    <div className={styles.name}>
                      <FigureName figure={figure} />
                    </div>
                    <LevelTag level={figure.nivel} />
                    <div className={styles.meta}>
                      {figure.programa_base && view !== "base" ? (
                        <span className={styles.base}>Base</span>
                      ) : null}
                      <span>{figure.tipo}</span>
                      {view !== "base" ? <span>{figure.familia}</span> : null}
                      <span>p. {figure.pagina}</span>
                      {figure.prerrequisitos_sugeridos.length ? (
                        <span className={styles.prereqs}>
                          Antes:{" "}
                          {figure.prerrequisitos_sugeridos.map((id, index) => {
                            const prerequisite = byId.get(id);
                            if (!prerequisite) return null;
                            return (
                              <span key={id}>
                                {index ? ", " : ""}
                                <button type="button" onClick={() => goToFigure(id)}>
                                  {prerequisite.nombre_es || prerequisite.nombre}
                                </button>
                              </span>
                            );
                          })}
                        </span>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>
                  <strong>Sin resultados</strong>
                  <span>Prueba con otro nombre o quita filtros.</span>
                </div>
              )}
            </div>

            {filtered.length > limit ? (
              <div className={styles.moreWrap}>
                <button className={styles.more} type="button" onClick={() => setLimit(limit + 200)}>
                  Mostrar más
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section>
            <p className={styles.note}>
              Secuencias semilla por nivel. En una fase posterior podrán alimentar un generador que
              combine figuras ya logradas con una nueva figura del nivel de la alumna.
            </p>
            <div className={styles.combos}>
              {(["Principiante", "Intermedio", "Avanzado"] as const).flatMap((level) =>
                combos
                  .filter((combo) => combo.nivel === level)
                  .map((combo, comboIndex) => (
                    <article className={styles.combo} key={`${level}-${comboIndex}`}>
                      <LevelTag level={level} />
                      <div className={styles.sequence}>
                        {combo.figuras.map((id, index) => {
                          const figure = byId.get(id);
                          return (
                            <span key={id}>
                              {index ? <span className={styles.arrow}>→</span> : null}
                              <button type="button" onClick={() => goToFigure(id)}>
                                {figure?.nombre_es || figure?.nombre || id}
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </article>
                  )),
              )}
            </div>
          </section>
        )}

        <p className={styles.note}>
          “Profesional” se conserva para consulta, pero queda fuera de cualquier futura generación
          automática. Este catálogo no incorpora textos ni fotografías del material de referencia;
          las descripciones futuras deberán ser propias de Demeter.
        </p>
      </div>
    </main>
  );
}
