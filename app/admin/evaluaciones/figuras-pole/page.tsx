import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { loadPoleCatalog } from "@/lib/pole/admin-data";
import { POLE_LEVEL_LABEL, type PoleCatalogLevel } from "@/lib/pole/types";

import { importPoleCatalogAction } from "./actions";

const LEVELS: PoleCatalogLevel[] = ["principiante", "intermedio", "avanzado", "profesional"];
const MAX_ROWS = 300;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default async function PoleFiguresCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    discipline?: string;
    nivel?: string;
    familia?: string;
    q?: string;
    base?: string;
    error?: string;
    imported?: string;
  }>;
}) {
  const [qs, ctx] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.EVALUATIONS_READ),
  ]);
  const canConfigure = ctx.can(CAPABILITIES.EVALUATIONS_CONFIGURE);

  const { data: disciplineRows } = await ctx.supabase
    .from("disciplines")
    .select("id,name")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("name");
  const disciplines = (disciplineRows ?? []) as { id: string; name: string }[];

  const counts = await Promise.all(
    disciplines.map(async (discipline: { id: string; name: string }) => {
      const { count } = await ctx.supabase
        .from("pole_figure_profiles")
        .select("element_id", { count: "exact", head: true })
        .eq("studio_id", ctx.studio.id)
        .eq("discipline_id", discipline.id);
      return [discipline.id, count ?? 0] as const;
    }),
  );
  const countByDiscipline = new Map<string, number>(counts);

  const poleGuess =
    disciplines.find((d) => (countByDiscipline.get(d.id) ?? 0) > 0) ??
    disciplines.find((d) => /pole/i.test(d.name) && !/exotic/i.test(d.name)) ??
    disciplines[0];
  const selected = disciplines.find((d) => d.id === qs.discipline) ?? poleGuess ?? null;
  const selectedCount = selected ? (countByDiscipline.get(selected.id) ?? 0) : 0;

  const catalog =
    selected && selectedCount > 0
      ? await loadPoleCatalog(ctx.supabase, ctx.studio.id, selected.id)
      : [];
  const nameById = new Map(catalog.map((figure) => [figure.id, figure.name]));
  const families = [...new Set(catalog.map((figure) => figure.family))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );

  const level = LEVELS.includes(qs.nivel as PoleCatalogLevel) ? (qs.nivel as PoleCatalogLevel) : "";
  const onlyCore = qs.base !== "0";
  const needle = normalize(qs.q?.trim() ?? "");
  const filtered = catalog.filter(
    (figure) =>
      (!level || figure.level === level) &&
      (!qs.familia || figure.family === qs.familia) &&
      (!onlyCore || figure.core || figure.level === "profesional") &&
      (!needle ||
        normalize(figure.name).includes(needle) ||
        normalize(figure.original_name).includes(needle)),
  );

  const levelCounts = LEVELS.map((item) => ({
    level: item,
    core: catalog.filter((figure) => figure.level === item && figure.core).length,
    total: catalog.filter((figure) => figure.level === item).length,
  }));

  return (
    <main className="evaluations-page">
      <header className="eval-header">
        <div className="eval-header-copy">
          <Link className="back-link compact" href="/admin/evaluaciones">
            ← Evaluaciones
          </Link>
          <h1>Figuras de Pole</h1>
          <p>
            Catálogo de figuras por nivel con sus prerrequisitos. Alimenta los combos de cada clase
            y el progreso de las alumnas en su portal.
          </p>
        </div>
      </header>

      {qs.imported ? (
        <div className="eval-notice" role="status">
          Catálogo cargado: {qs.imported} figuras revisadas. Las que ya existían se actualizaron sin
          duplicarse.
        </div>
      ) : null}
      {qs.error ? (
        <div className="eval-notice" role="alert">
          {qs.error === "import"
            ? "No pudimos cargar el catálogo. Revisa que tengas permiso de configurar evaluaciones."
            : "Elige una disciplina válida."}
        </div>
      ) : null}

      <section className="eval-panel eval-config-section">
        <header>
          <div>
            <h2>Disciplina</h2>
            <p>El catálogo vive por disciplina. Normalmente es Pole Fitness.</p>
          </div>
        </header>
        <div className="pole-catalog-disciplines">
          {disciplines.map((discipline) => (
            <Link
              key={discipline.id}
              href={`/admin/evaluaciones/figuras-pole?discipline=${discipline.id}`}
              className={`ui-badge ${discipline.id === selected?.id ? "ui-badge-accent" : "ui-badge-neutral"}`}
              aria-current={discipline.id === selected?.id ? "page" : undefined}
            >
              {discipline.name} · {countByDiscipline.get(discipline.id) ?? 0}
            </Link>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="eval-panel eval-config-section">
          <header>
            <div>
              <h2>{selected.name}</h2>
              <p>
                {selectedCount
                  ? `${selectedCount} figuras en el catálogo.`
                  : "Esta disciplina todavía no tiene catálogo de figuras."}
              </p>
            </div>
            {canConfigure ? (
              <form action={importPoleCatalogAction}>
                <input type="hidden" name="discipline_id" value={selected.id} />
                <button
                  type="submit"
                  className={selectedCount ? "secondary-button" : "primary-button"}
                >
                  {selectedCount ? "Recargar catálogo base" : "Cargar catálogo base"}
                </button>
              </form>
            ) : null}
          </header>

          {!selectedCount ? (
            <div className="ui-state ui-state-empty">
              <strong>¿Qué se carga?</strong>
              <div>
                1,206 figuras: 123 del programa base con nombre en español y prerrequisitos, figuras
                extra y 286 de nivel Profesional (sólo se abren con autorización). También 28 combos
                base. Sólo nombres, nivel, familia y página de referencia del libro; sin textos ni
                imágenes. Si ya existe una figura con el mismo nombre en Evaluaciones, se reutiliza.
              </div>
            </div>
          ) : (
            <>
              <div className="pole-catalog-stats">
                {levelCounts.map((item) => (
                  <div key={item.level} className="pole-catalog-stat">
                    <small>{POLE_LEVEL_LABEL[item.level]}</small>
                    <strong>{item.level === "profesional" ? item.total : item.core}</strong>
                    <span>
                      {item.level === "profesional"
                        ? "requieren autorización"
                        : `del programa base · ${item.total} en total`}
                    </span>
                  </div>
                ))}
              </div>

              <form className="pole-catalog-filters" method="get">
                <input type="hidden" name="discipline" value={selected.id} />
                <label>
                  <span>Buscar</span>
                  <input
                    id="pole-catalog-q"
                    className="ui-input"
                    type="search"
                    name="q"
                    defaultValue={qs.q ?? ""}
                    placeholder="Nombre en español o inglés"
                  />
                </label>
                <label>
                  <span>Nivel</span>
                  <select
                    id="pole-catalog-level"
                    className="ui-input"
                    name="nivel"
                    defaultValue={level}
                  >
                    <option value="">Todos</option>
                    {LEVELS.map((item) => (
                      <option key={item} value={item}>
                        {POLE_LEVEL_LABEL[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Familia</span>
                  <select
                    id="pole-catalog-family"
                    className="ui-input"
                    name="familia"
                    defaultValue={qs.familia ?? ""}
                  >
                    <option value="">Todas</option>
                    {families.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Mostrar</span>
                  <select
                    id="pole-catalog-base"
                    className="ui-input"
                    name="base"
                    defaultValue={onlyCore ? "1" : "0"}
                  >
                    <option value="1">Programa base y Profesional</option>
                    <option value="0">Todas, incluidas las extra</option>
                  </select>
                </label>
                <button type="submit" className="secondary-button">
                  Filtrar
                </button>
              </form>

              <p className="muted">
                {filtered.length} figuras
                {filtered.length > MAX_ROWS ? ` · mostrando las primeras ${MAX_ROWS}` : ""}
              </p>

              <div className="pole-catalog-table-wrap">
                <table className="pole-catalog-table">
                  <thead>
                    <tr>
                      <th scope="col">Figura</th>
                      <th scope="col">Nivel</th>
                      <th scope="col">Tipo · familia</th>
                      <th scope="col">Antes necesita</th>
                      <th scope="col">Libro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, MAX_ROWS).map((figure) => (
                      <tr key={figure.id}>
                        <td>
                          <strong>{figure.name}</strong>
                          {figure.name !== figure.original_name ? (
                            <small>{figure.original_name}</small>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`ui-badge ${figure.level === "profesional" ? "ui-badge-danger" : "ui-badge-neutral"}`}
                          >
                            {POLE_LEVEL_LABEL[figure.level]}
                          </span>
                        </td>
                        <td>
                          {figure.type}
                          <small>{figure.family}</small>
                        </td>
                        <td>
                          {figure.prerequisites.length
                            ? figure.prerequisites.map((id) => nameById.get(id) ?? "—").join(", ")
                            : "—"}
                        </td>
                        <td>{figure.book_page ? `p. ${figure.book_page}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : (
        <div className="ui-state ui-state-empty">
          <strong>No hay disciplinas activas</strong>
        </div>
      )}
    </main>
  );
}
